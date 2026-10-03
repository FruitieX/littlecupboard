CREATE TABLE ai_image_jobs(
    id TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    request_id TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    prompt TEXT NOT NULL DEFAULT '',
    proposal_id TEXT,
    recipe_id TEXT,
    product_id TEXT,
    items TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    result TEXT,
    error TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    started_at INTEGER,
    finished_at INTEGER
);
CREATE UNIQUE INDEX ai_image_jobs_request ON ai_image_jobs(household_id,request_id);
CREATE INDEX ai_image_jobs_scope ON ai_image_jobs(household_id,scope,created_at);
CREATE INDEX ai_image_jobs_proposal ON ai_image_jobs(household_id,proposal_id,created_at);
CREATE INDEX ai_image_jobs_pending ON ai_image_jobs(status,created_at);
INSERT INTO schema_migrations(version,applied_at) VALUES(10,datetime('now'));
