-- Keep source artwork at its original resolution during upload and restore.
ALTER TABLE uploads ADD COLUMN source INTEGER NOT NULL DEFAULT 0 CHECK(source IN (0,1));
INSERT INTO schema_migrations(version,applied_at) VALUES(7,datetime('now'));
