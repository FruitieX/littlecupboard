-- Protect household consumption-rate JSON from older strict state readers.
INSERT INTO schema_migrations(version,applied_at) VALUES(6,datetime('now'));
