use crate::{
    error::{ApiError, Result},
    model::Snapshot,
};
use rusqlite::{Connection, params};
use std::{
    path::Path,
    sync::{Arc, Mutex, MutexGuard},
};

#[derive(Clone)]
pub struct Database(pub Arc<Mutex<Connection>>);
impl Database {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;",
        )?;
        conn.execute_batch("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)")?;
        let version: i64 = conn.query_row(
            "SELECT COALESCE(MAX(version),0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )?;
        if version > 1 {
            return Err(ApiError::internal(
                "This database was created by a newer ForkBasket version. Restore a compatible backup before downgrading.",
            ));
        }
        if version == 0 {
            conn.execute_batch("BEGIN IMMEDIATE")?;
            conn.execute_batch(include_str!("../migrations/001_initial.sql"))?;
            conn.execute_batch("COMMIT")?;
        }
        conn.execute("DELETE FROM sessions WHERE expires_at < unixepoch()", [])?;
        conn.execute("DELETE FROM invitations WHERE expires_at < unixepoch()", [])?;
        conn.execute(
            "DELETE FROM ai_proposals WHERE created_at < unixepoch()-86400",
            [],
        )?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        }
        Ok(Self(Arc::new(Mutex::new(conn))))
    }
    pub fn lock(&self) -> Result<MutexGuard<'_, Connection>> {
        self.0
            .lock()
            .map_err(|_| ApiError::internal("database lock poisoned"))
    }
    pub fn snapshot(conn: &Connection, household: &str) -> Result<Snapshot> {
        let (revision, data): (u32, String) = conn.query_row(
            "SELECT revision, state FROM households WHERE id=?1",
            [household],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        Ok(Snapshot {
            revision,
            state: serde_json::from_str(&data)?,
        })
    }
    pub fn save(conn: &Connection, household: &str, snapshot: &Snapshot) -> Result<()> {
        conn.execute(
            "UPDATE households SET revision=?1, state=?2 WHERE id=?3",
            params![
                snapshot.revision,
                serde_json::to_string(&snapshot.state)?,
                household
            ],
        )?;
        Ok(())
    }
}
