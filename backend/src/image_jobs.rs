use crate::{
    Server, ai, api,
    auth::authenticate,
    error::{ApiError, Result},
    icon_batch::{self, IconResult, IconSubject},
    icon_jobs::config_for,
    model::Product,
};
use axum::{
    Json,
    extract::{Query, State},
    http::HeaderMap,
};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use ts_rs::TS;
use uuid::Uuid;

/// Queued work expires rather than blocking a dialog forever, and completed
/// results stay recoverable while the family may still be returning to them.
const QUEUED_EXPIRY_SECS: i64 = 1800;
const RUNNING_EXPIRY_SECS: i64 = 900;
const RECENT_DONE_SECS: i64 = 7200;
const CANDIDATE_LIMIT: usize = 20;

/// Durable image-generation jobs: a dialog can sleep, reconnect or reopen and
/// still collect the finished image. `kind` is item/recipe/store for a single
/// picture or `sheet` for an icon sheet of up to sixteen items.
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct AiJobRequest {
    pub request_id: Option<String>,
    #[serde(default)]
    pub scope: String,
    pub kind: String,
    #[serde(default)]
    pub prompt: String,
    pub proposal_id: Option<String>,
    pub recipe_id: Option<String>,
    pub product_id: Option<String>,
    pub items: Option<Vec<IconSubject>>,
}
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct AiJobView {
    pub id: String,
    pub status: String,
    pub kind: String,
    pub scope: String,
    pub proposal_id: Option<String>,
    pub recipe_id: Option<String>,
    pub product_id: Option<String>,
    pub url: Option<String>,
    pub icons: Option<Vec<IconResult>>,
    /// The item a photo job added or recorded as bought.
    pub name: Option<String>,
    pub error: Option<String>,
    #[ts(type = "number")]
    pub created_at: i64,
}
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct AiJobs {
    pub jobs: Vec<AiJobView>,
}
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/api/")]
pub struct AiJobCreated {
    pub job_id: String,
    pub status: String,
}

pub async fn create(
    State(server): State<Server>,
    headers: HeaderMap,
    Json(input): Json<AiJobRequest>,
) -> Result<Json<AiJobCreated>> {
    let actor = authenticate(&server, &headers)?;
    let sheet = input.kind == "sheet";
    let photo = input.kind == "photo";
    if !sheet && !photo && ai::ImageKind::parse(&input.kind).is_none() {
        return Err(ApiError::bad("Choose item, recipe, store, sheet or photo."));
    }
    if input.scope.len() > 200 {
        return Err(ApiError::bad("The recovery scope is too long."));
    }
    if let Some(id) = &input.request_id
        && (id.is_empty() || id.len() > 100)
    {
        return Err(ApiError::bad("Invalid request id."));
    }
    let conn = server.db.lock()?;
    // A retry after a lost response must collect the original job instead of
    // spending the provider twice.
    if let Some(id) = input.request_id.as_deref()
        && let Some(existing) = conn
            .query_row(
                "SELECT id,status FROM ai_image_jobs WHERE household_id=?1 AND request_id=?2",
                params![actor.household_id, id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
    {
        return Ok(Json(AiJobCreated {
            job_id: existing.0,
            status: existing.1,
        }));
    }
    // Resolve the subject now so validation failures never create dead work.
    let (prompt, items_json) = if photo {
        // Fire-and-forget: recognize photos and/or a typed name and add the
        // item (`list`), record it as bought (`bought`) or put it in the
        // cupboard (`pantry`), even if the phone sleeps.
        (photo_prompt(&conn, &actor, &input.prompt)?, None)
    } else if sheet {
        let items = input.items.as_deref().unwrap_or_default();
        icon_batch::validate_items(items)?;
        let resolved = icon_batch::resolve_items(
            &conn,
            &actor.household_id,
            items,
            input.proposal_id.as_deref(),
        )?;
        let subjects: Vec<IconSubject> = resolved
            .iter()
            .map(|product| IconSubject {
                id: product.id.clone(),
                name: product.name.clone(),
                category: product.category.clone(),
            })
            .collect();
        (String::new(), Some(serde_json::to_string(&subjects)?))
    } else {
        let subject = ai::resolve_image_subject(
            &conn,
            &actor.household_id,
            &ai::ImageKind::parse(&input.kind).unwrap(),
            &input.prompt,
            input.proposal_id.as_deref(),
            input.recipe_id.as_deref(),
            input.product_id.as_deref(),
        )?;
        (subject, None)
    };
    // An identical generation already in flight is adopted rather than run
    // twice when a family member asks again before it finishes.
    // Photo jobs each describe a different item, so they never adopt.
    let adopted = if photo {
        None
    } else {
        conn.query_row(
            "SELECT id,status FROM ai_image_jobs WHERE household_id=?1 AND kind=?2 AND scope=?3 AND proposal_id IS ?4 AND recipe_id IS ?5 AND product_id IS ?6 AND COALESCE(items,'')=?7 AND status IN ('queued','running') ORDER BY created_at LIMIT 1",
            params![
                actor.household_id,
                input.kind,
                input.scope,
                input.proposal_id,
                input.recipe_id,
                input.product_id,
                items_json.as_deref().unwrap_or("")
            ],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?
    };
    if let Some((id, status)) = adopted {
        return Ok(Json(AiJobCreated { job_id: id, status }));
    }
    if photo {
        server.rate_limit(&format!("ai-photo:{}", actor.household_id), 60, 3600)?;
    } else {
        server.rate_limit(&format!("ai-image:{}", actor.household_id), 20, 3600)?;
    }
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO ai_image_jobs(id,household_id,request_id,scope,kind,prompt,proposal_id,recipe_id,product_id,items) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            id,
            actor.household_id,
            input
                .request_id
                .unwrap_or_else(|| Uuid::new_v4().to_string()),
            input.scope,
            input.kind,
            prompt,
            input.proposal_id,
            input.recipe_id,
            input.product_id,
            items_json
        ],
    )?;
    Ok(Json(AiJobCreated {
        job_id: id,
        status: "queued".into(),
    }))
}

/// Validates a background item request: up to four household photos and/or
/// a typed name, plus any fields the family already chose, which the AI keeps.
fn photo_prompt(
    conn: &rusqlite::Connection,
    actor: &crate::auth::Actor,
    prompt: &str,
) -> Result<String> {
    let request: Value =
        serde_json::from_str(prompt).map_err(|_| ApiError::bad("Describe the photo job."))?;
    let mut photos: Vec<String> = request["photos"]
        .as_array()
        .map(|photos| {
            photos
                .iter()
                .filter_map(|p| p.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    if let Some(photo) = request["photo"].as_str() {
        photos.push(photo.to_string());
    }
    let owned = |url: &str| {
        url.strip_prefix("/api/images/")
            .filter(|id| Uuid::parse_str(id).is_ok())
            .is_some_and(|id| {
                conn.query_row(
                    "SELECT EXISTS(SELECT 1 FROM uploads WHERE id=?1 AND household_id=?2)",
                    params![id, actor.household_id],
                    |row| row.get::<_, bool>(0),
                )
                .unwrap_or(false)
            })
    };
    let mode = request["mode"].as_str().unwrap_or_default();
    if photos.len() > 4
        || !photos.iter().all(|url| owned(url))
        || !matches!(mode, "list" | "bought" | "pantry")
    {
        return Err(ApiError::bad("Take the photo again and retry."));
    }
    let name = request["name"].as_str().unwrap_or_default().trim();
    if name.chars().count() > 80 || name.is_empty() && photos.is_empty() {
        return Err(ApiError::bad("Enter an item name or add a photo."));
    }
    let quantity = request["quantity"].as_f64();
    let unit = request["unit"]
        .as_str()
        .map(str::trim)
        .filter(|unit| !unit.is_empty());
    let note = request["note"]
        .as_str()
        .map(str::trim)
        .filter(|note| !note.is_empty());
    let group = request["group"].as_str();
    let product_id = request["productId"].as_str();
    let image = request["image"].as_str().filter(|image| !image.is_empty());
    let state = crate::db::Database::snapshot(conn, &actor.household_id)?.state;
    if quantity.is_some_and(|q| !q.is_finite() || q <= 0.0 || q > 100000.0)
        || unit.is_some_and(|unit| unit.chars().count() > 20)
        || note.is_some_and(|note| note.chars().count() > 300)
        || group.is_some_and(|group| !state.groups.iter().any(|g| g == group))
        || product_id.is_some_and(|id| crate::domain::product(&state, id).is_err())
        || image.is_some_and(|image| !crate::domain::valid_image(image))
    {
        return Err(ApiError::bad("Check the item details and try again."));
    }
    Ok(json!({"photos":photos,"name":name,"quantity":quantity,"unit":unit,"note":note,"group":group,"productId":product_id,"image":image,"mode":mode,"actor":actor.user.name}).to_string())
}

#[derive(Deserialize)]
pub struct JobsQuery {
    pub id: Option<String>,
    pub scope: Option<String>,
    pub proposal: Option<String>,
}

const VIEW_COLUMNS: &str =
    "id,status,kind,scope,proposal_id,recipe_id,product_id,result,error,created_at";

fn view_from(row: &rusqlite::Row<'_>) -> rusqlite::Result<AiJobView> {
    let result: Option<String> = row.get(7)?;
    let mut url = None;
    let mut icons = None;
    let mut name = None;
    if let Some(text) = result
        && let Ok(value) = serde_json::from_str::<Value>(&text)
    {
        url = value["url"].as_str().map(String::from);
        name = value["name"].as_str().map(String::from);
        if let Some(entries) = value["icons"].as_array() {
            icons = Some(
                entries
                    .iter()
                    .filter_map(|entry| serde_json::from_value::<IconResult>(entry.clone()).ok())
                    .collect(),
            );
        }
    }
    Ok(AiJobView {
        id: row.get(0)?,
        status: row.get(1)?,
        kind: row.get(2)?,
        scope: row.get(3)?,
        proposal_id: row.get(4)?,
        recipe_id: row.get(5)?,
        product_id: row.get(6)?,
        url,
        icons,
        name,
        error: row.get(8)?,
        created_at: row.get(9)?,
    })
}

pub async fn list(
    State(server): State<Server>,
    headers: HeaderMap,
    Query(query): Query<JobsQuery>,
) -> Result<Json<AiJobs>> {
    let actor = authenticate(&server, &headers)?;
    let conn = server.db.lock()?;
    let jobs: Vec<AiJobView> = if let Some(id) = query.id.filter(|value| !value.is_empty()) {
        let mut statement = conn.prepare(&format!(
            "SELECT {VIEW_COLUMNS} FROM ai_image_jobs WHERE id=?1 AND household_id=?2"
        ))?;
        statement
            .query_map(params![id, actor.household_id], view_from)?
            .collect::<std::result::Result<_, _>>()?
    } else {
        let recent = format!(
            "(status IN ('queued','running') OR (status='done' AND finished_at > unixepoch()-{RECENT_DONE_SECS}))"
        );
        if let Some(scope) = query.scope.filter(|value| !value.is_empty()) {
            let mut statement = conn.prepare(&format!(
                "SELECT {VIEW_COLUMNS} FROM ai_image_jobs WHERE household_id=?1 AND scope=?2 AND {recent} ORDER BY created_at DESC LIMIT 50"
            ))?;
            statement
                .query_map(params![actor.household_id, scope], view_from)?
                .collect::<std::result::Result<_, _>>()?
        } else if let Some(proposal) = query.proposal.filter(|value| !value.is_empty()) {
            let mut statement = conn.prepare(&format!(
                "SELECT {VIEW_COLUMNS} FROM ai_image_jobs WHERE household_id=?1 AND proposal_id=?2 AND {recent} ORDER BY created_at DESC LIMIT 50"
            ))?;
            statement
                .query_map(params![actor.household_id, proposal], view_from)?
                .collect::<std::result::Result<_, _>>()?
        } else {
            return Err(ApiError::bad("Choose a job id, scope or proposal."));
        }
    };
    Ok(Json(AiJobs { jobs }))
}

struct Job {
    id: String,
    household: String,
    kind: String,
    prompt: String,
    proposal_id: Option<String>,
    recipe_id: Option<String>,
    product_id: Option<String>,
    items: Vec<Product>,
}

struct Candidate {
    job: Job,
    companion: bool,
}

type QueuedRow = (
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

fn candidates(server: &Server) -> Result<Vec<Candidate>> {
    let mut conn = server.db.lock()?;
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE ai_image_jobs SET status='failed',error='The assistant was unavailable for too long. Try again.',finished_at=unixepoch() WHERE status='queued' AND created_at < unixepoch()-?1",
        params![QUEUED_EXPIRY_SECS],
    )?;
    tx.execute(
        "UPDATE ai_image_jobs SET status='failed',error='The generation was interrupted. Try again.',finished_at=unixepoch() WHERE status='running' AND started_at < unixepoch()-?1",
        params![RUNNING_EXPIRY_SECS],
    )?;
    let rows: Vec<QueuedRow> = tx
        .prepare("SELECT id,household_id,kind,prompt,proposal_id,recipe_id,product_id,items FROM ai_image_jobs WHERE status='queued' ORDER BY created_at,id LIMIT ?1")?
        .query_map(params![CANDIDATE_LIMIT as i64], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
            ))
        })?
        .collect::<std::result::Result<_, _>>()?;
    let mut result = vec![];
    for (id, household, kind, prompt, proposal_id, recipe_id, product_id, items_json) in rows {
        let config = config_for(&tx, &household)?;
        // Photo jobs only need the chat model; their icon is a separate job.
        let Some(config) = config
            .filter(|config| config.enabled && (kind == "photo" || !config.image_model.is_empty()))
        else {
            tx.execute(
                "UPDATE ai_image_jobs SET status='failed',error='Enable the assistant and configure an image model first.',finished_at=unixepoch() WHERE id=?1",
                params![id],
            )?;
            continue;
        };
        let items = items_json
            .map(|text| serde_json::from_str::<Vec<IconSubject>>(&text))
            .transpose()?
            .unwrap_or_default()
            .into_iter()
            .map(|item| Product {
                id: item.id,
                name: item.name,
                category: item.category,
                icon: "🛒".into(),
                aliases: vec![],
                image: None,
                interval: None,
            })
            .collect();
        result.push(Candidate {
            job: Job {
                id,
                household,
                kind,
                prompt,
                proposal_id,
                recipe_id,
                product_id,
                items,
            },
            companion: config.transport == "companion",
        });
    }
    tx.commit()?;
    Ok(result)
}

async fn claim(server: &Server) -> Result<Option<Job>> {
    let candidates = candidates(server)?;
    let mut online: std::collections::HashMap<String, bool> = std::collections::HashMap::new();
    for candidate in candidates {
        if candidate.companion
            && !*online
                .entry(candidate.job.household.clone())
                .or_insert_with(|| {
                    crate::companion::status(server, &candidate.job.household)
                        .ok()
                        .and_then(|value| value["online"].as_bool())
                        .unwrap_or(false)
                })
        {
            // A sleeping companion keeps its queued work for a while instead
            // of failing instantly; the sweep expires it eventually.
            continue;
        }
        let claimed = server.db.lock()?.execute(
            "UPDATE ai_image_jobs SET status='running',started_at=unixepoch() WHERE id=?1 AND status='queued'",
            params![candidate.job.id],
        )? == 1;
        if claimed {
            return Ok(Some(candidate.job));
        }
    }
    Ok(None)
}

fn attach_proposal_image(conn: &rusqlite::Connection, job: &Job, url: &str) -> Result<()> {
    let Some(proposal_id) = job.proposal_id.as_deref() else {
        return Ok(());
    };
    let Ok(mut proposal) = ai::image_proposal(conn, &job.household, proposal_id) else {
        // The proposal may have expired or been applied; deliver the image
        // anyway so finished work is never thrown away.
        return Ok(());
    };
    let mut updated = false;
    if let Some(recipe_id) = &job.recipe_id
        && let Some(recipe) = proposal.recipes.iter_mut().find(|r| &r.id == recipe_id)
    {
        recipe.image = url.into();
        updated = true;
    }
    if let Some(product_id) = &job.product_id
        && let Some(product) = proposal.products.iter_mut().find(|p| &p.id == product_id)
    {
        product.image = Some(url.into());
        updated = true;
    }
    if updated {
        conn.execute(
            "UPDATE ai_proposals SET proposal=?3 WHERE id=?1 AND household_id=?2",
            params![
                proposal_id,
                job.household,
                serde_json::to_string(&proposal)?
            ],
        )?;
    }
    Ok(())
}

fn finish_image(server: &Server, job: &Job, image: Result<api::StoredImage>) -> Result<()> {
    let mut conn = server.db.lock()?;
    let tx = conn.transaction()?;
    let active: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM ai_image_jobs WHERE id=?1 AND status='running')",
        params![job.id],
        |row| row.get(0),
    )?;
    if !active {
        return Ok(());
    }
    let mut applied = false;
    let (status, result, error) = match image {
        Err(error) => ("failed", None, Some(error.1)),
        Ok(image) => match api::insert_image(&tx, &job.household, image) {
            Err(error) => ("failed", None, Some(error.1)),
            Ok(url) => {
                attach_proposal_image(&tx, job, &url)?;
                applied = apply_item_icon(&tx, job, &url)?;
                ("done", Some(json!({"url": url}).to_string()), None)
            }
        },
    };
    tx.execute(
        "UPDATE ai_image_jobs SET status=?2,result=?3,error=?4,finished_at=unixepoch() WHERE id=?1",
        params![job.id, status, result, error],
    )?;
    tx.commit()?;
    if applied {
        server.notify(&job.household);
    }
    Ok(())
}

/// A finished icon for an item without a picture is used right away, so
/// nobody has to reopen the editor and press Save. Existing pictures are only
/// replaced from an open editor.
fn apply_item_icon(tx: &rusqlite::Transaction<'_>, job: &Job, url: &str) -> Result<bool> {
    let (Some(product_id), None, "item") = (&job.product_id, &job.proposal_id, job.kind.as_str())
    else {
        return Ok(false);
    };
    let mut snapshot = crate::db::Database::snapshot(tx, &job.household)?;
    if crate::domain::product(&snapshot.state, product_id).is_err()
        || snapshot
            .state
            .product_images
            .get(product_id)
            .is_some_and(|image| !image.is_empty())
        || snapshot
            .state
            .product_details
            .get(product_id)
            .is_some_and(|details| {
                details
                    .image
                    .as_ref()
                    .is_some_and(|image| image.starts_with("/api/images/"))
            })
        || snapshot
            .state
            .custom_products
            .iter()
            .any(|custom| custom.id == *product_id && custom.image.is_some())
    {
        return Ok(false);
    }
    let before = snapshot.state.clone();
    snapshot
        .state
        .product_images
        .insert(product_id.clone(), url.into());
    crate::domain::validate(&snapshot.state)?;
    let changes = crate::domain::changes(&before, &snapshot.state)?;
    snapshot.revision += 1;
    crate::db::Database::save(tx, &job.household, &snapshot)?;
    let name = crate::domain::product(&snapshot.state, product_id)
        .map(|product| product.name)
        .unwrap_or_default();
    tx.execute("INSERT INTO events(id,household_id,actor,kind,at,detail,changes) VALUES(?1,?2,'AI assistant','generateItemIcon',?3,?4,?5)",params![Uuid::new_v4().to_string(),job.household,chrono::Utc::now().to_rfc3339(),json!({"productId":product_id,"name":name}).to_string(),serde_json::to_string(&changes)?])?;
    Ok(true)
}

/// Recognizes a photographed or typed item and adds it (`list`), records it
/// as bought (`bought`) or puts it in the cupboard (`pantry`) as one undoable
/// household change. New items keep the photos, get the suggested details
/// and queue an icon unless the family already chose a picture.
async fn run_photo(server: &Server, job: &Job) -> Result<()> {
    let request: Value = serde_json::from_str(&job.prompt)?;
    // Jobs queued before typed names were supported carry a single photo.
    let mut photos: Vec<String> = request["photos"]
        .as_array()
        .map(|photos| {
            photos
                .iter()
                .filter_map(|p| p.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    if let Some(photo) = request["photo"].as_str() {
        photos.push(photo.to_string());
    }
    let photo = photos.first().cloned();
    let name = request["name"].as_str().unwrap_or_default().to_string();
    // Typed in the add dialog: adds to whatever is already listed, as the
    // dialog's own Add button does.
    let typed = !name.is_empty();
    let fixed_quantity = request["quantity"].as_f64();
    let fixed_unit = request["unit"].as_str().map(String::from);
    let fixed_note = request["note"].as_str().map(String::from);
    let fixed_group = request["group"].as_str().map(String::from);
    let fixed_product = request["productId"].as_str().map(String::from);
    let image = request["image"].as_str().map(String::from);
    let mode = request["mode"].as_str().unwrap_or("list").to_string();
    let bought = mode == "bought";
    let pantry = mode == "pantry";
    let actor = request["actor"]
        .as_str()
        .unwrap_or("LittleCupboard")
        .to_string();
    let details = ai::suggest_item(
        server,
        &job.household,
        ai::ItemDetailsRequest {
            name: name.clone(),
            images: photos.clone(),
            quantity: fixed_quantity,
            unit: fixed_unit.clone(),
            note: fixed_note.clone(),
            group: fixed_group.clone(),
        },
    )
    .await
    .map(|mut details| {
        // What the family chose stays as they chose it.
        if let Some(quantity) = fixed_quantity {
            details.quantity = quantity;
        }
        if let Some(unit) = &fixed_unit {
            details.unit = unit.clone();
        }
        if let Some(note) = &fixed_note {
            details.note = note.clone();
        }
        if let Some(group) = &fixed_group {
            details.group = group.clone();
        }
        if fixed_product.is_some() {
            details.product_id = fixed_product.clone();
        }
        details
    });
    let mut conn = server.db.lock()?;
    let tx = conn.transaction()?;
    let active: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM ai_image_jobs WHERE id=?1 AND status='running')",
        params![job.id],
        |row| row.get(0),
    )?;
    if !active {
        return Ok(());
    }
    let outcome = details.and_then(|details| {
        let mut snapshot = crate::db::Database::snapshot(&tx, &job.household)?;
        let before = snapshot.state.clone();
        let state = &mut snapshot.state;
        let created = details.product_id.is_none();
        let id = details
            .product_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        if created {
            state.custom_products.push(Product {
                id: id.clone(),
                name: details.name.clone(),
                category: details.group.clone(),
                icon: "🛒".into(),
                aliases: vec![],
                image: None,
                interval: None,
            });
            if let Some(days) = details.shelf_life_days {
                state.shelf_life_days.insert(id.clone(), days);
            }
        }
        if created && let Some(image) = &image {
            state.product_images.insert(id.clone(), image.clone());
        }
        if !photos.is_empty() {
            let kept = state.item_photos.entry(id.clone()).or_default();
            for photo in &photos {
                if !kept.contains(photo) {
                    kept.push(photo.clone());
                }
            }
            let excess = kept.len().saturating_sub(12);
            kept.drain(..excess);
        }
        let today = crate::domain::today(state);
        // Marked until a family member approves the AI's work.
        state.ai_added.insert(id.clone(), mode.clone());
        let listed = crate::domain::displayed(state, &id, &today);
        if pantry {
            // "We have this": add the photographed amount to what is recorded.
            let photographed = crate::model::Amount {
                quantity: details.quantity,
                unit: details.unit.clone(),
            };
            let mut amounts = state
                .pantry
                .get(&id)
                .map(|entry| entry.amounts.clone())
                .unwrap_or_default();
            amounts.push(photographed);
            let amounts = crate::domain::totals(&amounts);
            let first = amounts[0].clone();
            crate::domain::apply(
                state,
                &crate::model::Operation::ObservePantry {
                    product_id: id.clone(),
                    quantity: first.quantity,
                    unit: first.unit,
                    expires_at: None,
                    amounts: Some(amounts),
                    note: None,
                    expected: None,
                },
                &today,
            )?;
        } else if typed && !bought || listed.as_ref().is_none_or(|item| item.checked) {
            crate::domain::apply(
                state,
                &crate::model::Operation::AddItem {
                    product_id: id.clone(),
                    quantity: details.quantity,
                    unit: details.unit.clone(),
                    note: details.note.clone(),
                    accumulate: typed,
                },
                &today,
            )?;
        }
        if bought {
            crate::domain::apply(
                state,
                &crate::model::Operation::CheckItem {
                    id: id.clone(),
                    checked: true,
                    expected: None,
                },
                &today,
            )?;
        }
        crate::domain::validate(&snapshot.state)?;
        let changes = crate::domain::changes(&before, &snapshot.state)?;
        snapshot.revision += 1;
        crate::db::Database::save(&tx, &job.household, &snapshot)?;
        // A bought item records the same checkItem event as tapping its tile,
        // so purchase learning and Undo work as usual.
        let kind = if bought {
            "checkItem"
        } else if pantry {
            "observePantry"
        } else {
            "addItem"
        };
        let detail = if bought {
            json!({"productId":id,"quantity":details.quantity,"unit":details.unit,"note":details.note,"checked":true,"storeId":snapshot.state.store_id,"photo":photo,"fromPhoto":photo.is_some()})
        } else {
            json!({"productId":id,"quantity":details.quantity,"unit":details.unit,"note":details.note,"photo":photo,"fromPhoto":photo.is_some()})
        };
        tx.execute("INSERT INTO events(id,household_id,actor,kind,at,detail,changes) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![Uuid::new_v4().to_string(),job.household,actor,kind,chrono::Utc::now().to_rfc3339(),detail.to_string(),serde_json::to_string(&changes)?])?;
        if created
            && image.is_none()
            && config_for(&tx, &job.household)?
                .is_some_and(|config| config.enabled && !config.image_model.is_empty())
        {
            tx.execute(
                "INSERT INTO ai_image_jobs(id,household_id,request_id,scope,kind,prompt,product_id) VALUES(?1,?2,?3,?4,'item',?5,?6)",
                params![
                    Uuid::new_v4().to_string(),
                    job.household,
                    Uuid::new_v4().to_string(),
                    format!("item:{id}"),
                    format!("{}: {}", details.name, details.icon_description),
                    id
                ],
            )?;
        }
        Ok(json!({"productId":id,"name":details.name,"created":created,"mode":mode}))
    });
    let (status, result, error) = match outcome {
        Ok(result) => ("done", Some(result.to_string()), None),
        Err(error) => ("failed", None, Some(error.1)),
    };
    tx.execute(
        "UPDATE ai_image_jobs SET status=?2,result=?3,error=?4,finished_at=unixepoch() WHERE id=?1",
        params![job.id, status, result, error],
    )?;
    tx.commit()?;
    drop(conn);
    if status == "done" {
        server.notify(&job.household);
    }
    Ok(())
}

fn finish_sheet(server: &Server, job: &Job, images: Result<Vec<api::StoredImage>>) -> Result<()> {
    let mut conn = server.db.lock()?;
    let active: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM ai_image_jobs WHERE id=?1 AND status='running')",
        params![job.id],
        |row| row.get(0),
    )?;
    if !active {
        return Ok(());
    }
    let (status, result, error) = match images {
        Err(error) => ("failed", None, Some(error.1)),
        Ok(images) => {
            let proposal = job
                .proposal_id
                .as_deref()
                .filter(|id| ai::image_proposal(&conn, &job.household, id).is_ok());
            match icon_batch::commit_sheet(&mut conn, &job.household, proposal, &job.items, images)
            {
                Ok(results) => ("done", Some(json!({"icons": results}).to_string()), None),
                Err(error) => ("failed", None, Some(error.1)),
            }
        }
    };
    conn.execute(
        "UPDATE ai_image_jobs SET status=?2,result=?3,error=?4,finished_at=unixepoch() WHERE id=?1",
        params![job.id, status, result, error],
    )?;
    Ok(())
}

pub async fn run_one(server: &Server) -> Result<bool> {
    let Some(job) = claim(server).await? else {
        return Ok(false);
    };
    match job.kind.as_str() {
        "photo" => run_photo(server, &job).await?,
        "sheet" => {
            let images = icon_batch::render(server, &job.household, &job.items).await;
            finish_sheet(server, &job, images)?;
        }
        kind => {
            let kind = ai::ImageKind::parse(kind)
                .ok_or_else(|| ApiError::internal("Unknown image job kind"))?;
            let image = ai::render_image(server, &job.household, kind, &job.prompt).await;
            finish_image(server, &job, image)?;
        }
    }
    Ok(true)
}

pub fn resume_interrupted(server: &Server) -> Result<()> {
    // Only the serving process calls this; administrative diagnostics don't
    // disturb active jobs. A crash resumes the queue after restart.
    server.db.lock()?.execute(
        "UPDATE ai_image_jobs SET status='queued',started_at=NULL WHERE status='running'",
        [],
    )?;
    Ok(())
}

pub fn start(server: Server) -> Result<()> {
    resume_interrupted(&server)?;
    tokio::spawn(async move {
        loop {
            // Run each pass in its own task so a panic cannot stop the queue.
            let pass = server.clone();
            match tokio::spawn(async move { run_one(&pass).await }).await {
                Ok(Ok(_)) => {}
                Ok(Err(error)) => tracing::error!("AI image queue: {}", error.1),
                Err(error) => {
                    tracing::error!("AI image queue pass panicked: {error}");
                    // Only one job runs at a time; fail it so retry controls appear.
                    if let Err(error) = server.db.lock().and_then(|conn| {
                        conn.execute(
                            "UPDATE ai_image_jobs SET status='failed',error='The generation failed unexpectedly. Try again.',finished_at=unixepoch() WHERE status='running'",
                            [],
                        )
                        .map_err(Into::into)
                    }) {
                        tracing::error!("AI image queue: {}", error.1);
                    }
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
    });
    Ok(())
}
