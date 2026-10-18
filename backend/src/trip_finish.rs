use crate::{Server, db::Database, domain, error::Result, model::Operation};
use chrono::{DateTime, Duration, Utc};
use rusqlite::{OptionalExtension, params};
use serde_json::json;
use uuid::Uuid;

/// A shopping trip with checked items finishes on its own after this long
/// without another check.
pub const IDLE: Duration = Duration::hours(1);

/// Finishes forgotten shopping trips as a normal, undoable household event.
pub fn start(server: Server) {
    tokio::spawn(async move {
        loop {
            let pass = server.clone();
            match tokio::task::spawn_blocking(move || run(&pass, Utc::now())).await {
                Ok(Ok(())) => {}
                Ok(Err(error)) => tracing::error!("Automatic trip finish: {}", error.1),
                Err(error) => tracing::error!("Automatic trip finish panicked: {error}"),
            }
            tokio::time::sleep(std::time::Duration::from_secs(300)).await;
        }
    });
}

pub fn run(server: &Server, now: DateTime<Utc>) -> Result<()> {
    let households: Vec<String> = {
        let conn = server.db.lock()?;
        conn.prepare("SELECT id FROM households")?
            .query_map([], |row| row.get(0))?
            .collect::<std::result::Result<_, _>>()?
    };
    for household in households {
        let changed = {
            let mut conn = server.db.lock()?;
            let tx = conn.transaction()?;
            let mut snapshot = Database::snapshot(&tx, &household)?;
            if !snapshot.state.items.iter().any(|item| item.checked) {
                continue;
            }
            // Checking, restoring and undoing a check all count as activity.
            let last: Option<(String, String)> = tx
                .query_row(
                    "SELECT at,detail FROM events WHERE household_id=?1 AND kind='checkItem' ORDER BY at DESC LIMIT 1",
                    params![household],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            let last_at = last
                .as_ref()
                .and_then(|(at, _)| DateTime::parse_from_rfc3339(at).ok())
                .map(|at| at.with_timezone(&Utc));
            if last_at.is_some_and(|at| now - at < IDLE) {
                continue;
            }
            let store = last
                .and_then(|(_, detail)| serde_json::from_str::<serde_json::Value>(&detail).ok())
                .and_then(|detail| detail["storeId"].as_str().map(String::from));
            let before = snapshot.state.clone();
            let mut detail = domain::apply(&mut snapshot.state, &Operation::FinishTrip, "")?;
            detail["automatic"] = json!(true);
            if let Some(store) = store {
                detail["storeId"] = json!(store);
            }
            if let Some(at) = last_at {
                detail["lastCheckAt"] = json!(at.to_rfc3339());
            }
            domain::validate(&snapshot.state)?;
            let changes = domain::changes(&before, &snapshot.state)?;
            snapshot.revision += 1;
            Database::save(&tx, &household, &snapshot)?;
            tx.execute(
                "INSERT INTO events(id,household_id,actor,kind,at,detail,changes) VALUES(?1,?2,'LittleCupboard','finishTrip',?3,?4,?5)",
                params![
                    Uuid::new_v4().to_string(),
                    household,
                    now.to_rfc3339(),
                    detail.to_string(),
                    serde_json::to_string(&changes)?
                ],
            )?;
            tx.commit()?;
            true
        };
        if changed {
            server.notify(&household);
        }
    }
    Ok(())
}
