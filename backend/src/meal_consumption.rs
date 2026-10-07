use crate::{Server, db::Database, domain, error::Result};
use rusqlite::params;
use serde_json::json;
use uuid::Uuid;

/// Uses planned meals' ingredients from each household's cupboard once the
/// meal has happened. Runs as a normal, undoable household event.
pub fn start(server: Server) {
    tokio::spawn(async move {
        loop {
            let pass = server.clone();
            match tokio::task::spawn_blocking(move || run(&pass)).await {
                Ok(Ok(())) => {}
                Ok(Err(error)) => tracing::error!("Planned meal consumption: {}", error.1),
                Err(error) => tracing::error!("Planned meal consumption panicked: {error}"),
            }
            tokio::time::sleep(std::time::Duration::from_secs(600)).await;
        }
    });
}

pub fn run(server: &Server) -> Result<()> {
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
            let zone = snapshot
                .state
                .preferences
                .time_zone
                .parse::<chrono_tz::Tz>()
                .unwrap_or(chrono_tz::UTC);
            let before = snapshot.state.clone();
            let now = chrono::Utc::now().with_timezone(&zone).naive_local();
            let days = domain::auto_consume(&mut snapshot.state, now);
            if days.is_empty() {
                false
            } else {
                domain::validate(&snapshot.state)?;
                let changes = domain::changes(&before, &snapshot.state)?;
                snapshot.revision += 1;
                Database::save(&tx, &household, &snapshot)?;
                let recipes = days
                    .iter()
                    .filter_map(|day| snapshot.state.plan.get(day))
                    .collect::<Vec<_>>();
                tx.execute(
                    "INSERT INTO events(id,household_id,actor,kind,at,detail,changes) VALUES(?1,?2,'LittleCupboard','autoConsume',?3,?4,?5)",
                    params![
                        Uuid::new_v4().to_string(),
                        household,
                        chrono::Utc::now().to_rfc3339(),
                        json!({"days":days,"recipeIds":recipes}).to_string(),
                        serde_json::to_string(&changes)?
                    ],
                )?;
                tx.commit()?;
                true
            }
        };
        if changed {
            server.notify(&household);
        }
    }
    Ok(())
}
