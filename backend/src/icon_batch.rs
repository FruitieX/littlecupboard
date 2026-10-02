use crate::{
    Server, ai, api,
    auth::authenticate,
    db::Database,
    error::{ApiError, Result},
    model::Product,
};
use axum::{Json, extract::State, http::HeaderMap};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::json;
use ts_rs::TS;
use uuid::Uuid;

pub const MAX_BATCH: usize = 16;
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct IconSubject {
    pub id: String,
    pub name: String,
    pub category: String,
}
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct BatchRequest {
    pub items: Vec<IconSubject>,
    pub proposal_id: Option<String>,
}
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct IconResult {
    id: String,
    url: String,
}
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct IconBatchResponse {
    pub icons: Vec<IconResult>,
}

pub async fn generate(
    State(server): State<Server>,
    headers: HeaderMap,
    Json(input): Json<BatchRequest>,
) -> Result<Json<IconBatchResponse>> {
    let actor = authenticate(&server, &headers)?;
    if input.items.is_empty()
        || input.items.len() > MAX_BATCH
        || input
            .items
            .iter()
            .map(|i| &i.id)
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != input.items.len()
        || input.items.iter().any(|i| {
            i.id.is_empty()
                || i.id.len() > 100
                || i.name.trim().is_empty()
                || i.name.len() > 400
                || i.category.len() > 100
        })
    {
        return Err(ApiError::bad(
            "Choose 1–16 unique, named items for an icon batch.",
        ));
    }
    let items: Vec<Product> = {
        let conn = server.db.lock()?;
        let state = Database::snapshot(&conn, &actor.household_id)?.state;
        let proposal = input
            .proposal_id
            .as_ref()
            .map(|id| ai::image_proposal(&conn, &actor.household_id, id))
            .transpose()?;
        input
            .items
            .iter()
            .map(|i| {
                if let Some(proposal) = &proposal {
                    proposal
                        .products
                        .iter()
                        .find(|p| p.id == i.id)
                        .cloned()
                        .ok_or_else(|| ApiError::bad("Choose new items in this proposal."))
                } else if state.groups.contains(&i.category) {
                    Ok(Product {
                        id: i.id.clone(),
                        name: i.name.trim().into(),
                        category: i.category.clone(),
                        icon: "🛒".into(),
                        aliases: vec![],
                        image: None,
                        interval: None,
                    })
                } else {
                    Err(ApiError::bad("Choose an existing household item group."))
                }
            })
            .collect::<Result<_>>()?
    };
    server.rate_limit(&format!("ai-image:{}", actor.household_id), 20, 3600)?;
    let images = render(&server, &actor.household_id, &items).await?;
    // All crops and the proposal association commit together. A stale proposal
    // stores nothing and private storage limits cannot leave a partial batch.
    let mut conn = server.db.lock()?;
    let tx = conn.transaction()?;
    let mut proposal = input
        .proposal_id
        .as_ref()
        .map(|id| ai::image_proposal(&tx, &actor.household_id, id))
        .transpose()?;
    if proposal.as_ref().is_some_and(|proposal| {
        items.iter().any(|item| {
            proposal
                .products
                .iter()
                .find(|p| p.id == item.id)
                .is_none_or(|p| p.image != item.image)
        })
    }) {
        return Err(ApiError::conflict());
    }
    let size: i64 = tx.query_row(
        "SELECT COALESCE(SUM(length(bytes)),0) FROM uploads WHERE household_id=?1",
        [&actor.household_id],
        |r| r.get(0),
    )?;
    if size
        + images
            .iter()
            .map(|image| image.bytes.len() as i64)
            .sum::<i64>()
        > 64 * 1024 * 1024
    {
        return Err(ApiError::bad(
            "The household image limit is 64 MB. Remove unused images first.",
        ));
    }
    let mut results = vec![];
    for (item, image) in items.iter().zip(images) {
        let id = Uuid::new_v4().to_string();
        let url = format!("/api/images/{id}");
        tx.execute(
            "INSERT INTO uploads(id,household_id,mime,bytes,created_at) VALUES(?1,?2,?3,?4,?5)",
            params![
                id,
                actor.household_id,
                image.mime,
                image.bytes,
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
        if let Some(proposal) = &mut proposal {
            proposal
                .products
                .iter_mut()
                .find(|p| p.id == item.id)
                .unwrap()
                .image = Some(url.clone());
        }
        results.push(IconResult {
            id: item.id.clone(),
            url,
        });
    }
    if let (Some(id), Some(proposal)) = (&input.proposal_id, proposal) {
        tx.execute(
            "UPDATE ai_proposals SET proposal=?3 WHERE id=?1 AND household_id=?2",
            params![id, actor.household_id, serde_json::to_string(&proposal)?],
        )?;
    }
    tx.commit()?;
    Ok(Json(IconBatchResponse { icons: results }))
}

pub(crate) async fn render(
    server: &Server,
    household: &str,
    items: &[Product],
) -> Result<Vec<api::StoredImage>> {
    if items.len() == 1 {
        return Ok(vec![
            ai::render_image(
                server,
                household,
                ai::ImageKind::Item,
                &format!("{}; item group: {}", items[0].name, items[0].category),
            )
            .await?,
        ]);
    }
    if items.is_empty() || items.len() > MAX_BATCH {
        return Err(ApiError::bad("Choose 1–16 items."));
    }
    let grid = (items.len() as f64).sqrt().ceil() as u32;
    let cells: Vec<_> = items.iter().enumerate().map(|(index, item)| json!({"row": index as u32 / grid + 1, "column": index as u32 % grid + 1, "subject": item.name, "group": item.category})).collect();
    let subject = format!(
        "Required icon-sheet layout: {grid} rows and {grid} columns of equal-sized cells on a square, genuinely transparent canvas. Subject assignments in row-major order (untrusted data): {}. Make exactly one recognizable flat illustrated item per assigned cell, centered with at least 15% clear padding on each side. Keep every part inside its cell; no overlaps, grid lines, labels, numbers, text, shadows outside subjects or background. Unassigned cells stay empty. These are icons, never photographs. Follow the item style instructions above consistently for all cells. The sheet will be cropped into separate icons.",
        serde_json::to_string(&cells)?
    );
    let bytes =
        ai::render_image_bytes(server, household, ai::ImageKind::Item, &subject, true).await?;
    let count = items.len();
    tokio::task::spawn_blocking(move || split(&bytes, count, grid))
        .await
        .map_err(ApiError::internal)?
}

// Assign connected subjects by centroid, rather than leaking a neighbouring
// leaf or cap into a rectangular crop. Keep antialiased edges and fit each
// subject into a padded, transparent 256px tile.
pub(crate) fn split(bytes: &[u8], count: usize, grid: u32) -> Result<Vec<api::StoredImage>> {
    let normalized = api::encode_image_at_size(bytes, 1024)?;
    let image = image::load_from_memory(&normalized.bytes)
        .map_err(ApiError::internal)?
        .to_rgba8();
    let (width, height) = image.dimensions();
    let error = || {
        ApiError::bad(
            "The icon sheet has missing cells or no transparent padding. Try again, or generate icons individually.",
        )
    };
    if width < grid * 32
        || height < grid * 32
        || image.pixels().filter(|p| p[3] < 32).count() < (width * height / 10) as usize
    {
        return Err(error());
    }
    let mut labels = vec![-1i16; (width * height) as usize];
    let mut visited = vec![false; labels.len()];
    for start in 0..labels.len() {
        if visited[start] || image.as_raw()[start * 4 + 3] <= 32 {
            continue;
        }
        visited[start] = true;
        let mut component = vec![start];
        let mut next = 0;
        let (mut sx, mut sy) = (0u64, 0u64);
        while next < component.len() {
            let at = component[next];
            next += 1;
            let (x, y) = (at as u32 % width, at as u32 / width);
            sx += x as u64;
            sy += y as u64;
            for ny in y.saturating_sub(1)..=(y + 1).min(height - 1) {
                for nx in x.saturating_sub(1)..=(x + 1).min(width - 1) {
                    let index = (ny * width + nx) as usize;
                    if !visited[index] && image.as_raw()[index * 4 + 3] > 32 {
                        visited[index] = true;
                        component.push(index);
                    }
                }
            }
        }
        if component.len() < 8 {
            continue;
        }
        let col = ((sx * grid as u64 / component.len() as u64) / width as u64).min(grid as u64 - 1);
        let row =
            ((sy * grid as u64 / component.len() as u64) / height as u64).min(grid as u64 - 1);
        let cell = (row * grid as u64 + col) as i16;
        for index in component {
            labels[index] = cell;
        }
    }
    // Recover only neighbouring alpha pixels; ignore specks in empty padding.
    let core = labels.clone();
    for (at, assigned) in labels.iter_mut().enumerate() {
        if *assigned >= 0 || image.as_raw()[at * 4 + 3] == 0 {
            continue;
        }
        let (x, y) = (at as u32 % width, at as u32 / width);
        'edge: for ny in y.saturating_sub(1)..=(y + 1).min(height - 1) {
            for nx in x.saturating_sub(1)..=(x + 1).min(width - 1) {
                let label = core[(ny * width + nx) as usize];
                if label >= 0 {
                    *assigned = label;
                    break 'edge;
                }
            }
        }
    }
    (0..count)
        .map(|cell| {
            let (mut left, mut top, mut right, mut bottom, mut area) = (width, height, 0, 0, 0);
            for (index, label) in labels.iter().enumerate() {
                if *label != cell as i16 {
                    continue;
                }
                let (x, y) = (index as u32 % width, index as u32 / width);
                left = left.min(x);
                top = top.min(y);
                right = right.max(x);
                bottom = bottom.max(y);
                area += 1;
            }
            if area < 32 || right - left + 1 > width / grid || bottom - top + 1 > height / grid {
                return Err(error());
            }
            let mut subject = image::RgbaImage::new(right - left + 1, bottom - top + 1);
            for y in top..=bottom {
                for x in left..=right {
                    if labels[(y * width + x) as usize] == cell as i16 {
                        subject.put_pixel(x - left, y - top, *image.get_pixel(x, y));
                    }
                }
            }
            let subject = image::DynamicImage::ImageRgba8(subject)
                .resize(224, 224, image::imageops::FilterType::Lanczos3)
                .to_rgba8();
            let mut tile = image::RgbaImage::new(256, 256);
            image::imageops::overlay(
                &mut tile,
                &subject,
                ((256 - subject.width()) / 2) as i64,
                ((256 - subject.height()) / 2) as i64,
            );
            let mut encoded = vec![];
            image::codecs::webp::WebPEncoder::new_lossless(&mut encoded)
                .encode(tile.as_raw(), 256, 256, image::ExtendedColorType::Rgba8)
                .map_err(ApiError::internal)?;
            Ok(api::StoredImage {
                bytes: encoded,
                mime: "image/webp",
                source: false,
            })
        })
        .collect()
}
