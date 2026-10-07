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
    if !sheet && ai::ImageKind::parse(&input.kind).is_none() {
        return Err(ApiError::bad("Choose item, recipe, store or sheet."));
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
    let (prompt, items_json) = if sheet {
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
    let adopted = conn
        .query_row(
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
        .optional()?;
    if let Some((id, status)) = adopted {
        return Ok(Json(AiJobCreated { job_id: id, status }));
    }
    server.rate_limit(&format!("ai-image:{}", actor.household_id), 20, 3600)?;
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
    if let Some(text) = result
        && let Ok(value) = serde_json::from_str::<Value>(&text)
    {
        url = value["url"].as_str().map(String::from);
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
        let Some(config) = config.filter(|config| config.enabled && !config.image_model.is_empty())
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
    let (status, result, error) = match image {
        Err(error) => ("failed", None, Some(error.1)),
        Ok(image) => match api::insert_image(&tx, &job.household, image) {
            Err(error) => ("failed", None, Some(error.1)),
            Ok(url) => {
                attach_proposal_image(&tx, job, &url)?;
                ("done", Some(json!({"url": url}).to_string()), None)
            }
        },
    };
    tx.execute(
        "UPDATE ai_image_jobs SET status=?2,result=?3,error=?4,finished_at=unixepoch() WHERE id=?1",
        params![job.id, status, result, error],
    )?;
    tx.commit()?;
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
