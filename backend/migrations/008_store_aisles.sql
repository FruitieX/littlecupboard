-- Older binaries require every item group in every store. Guard partial routes
-- against downgrade writes; existing routes and household data are unchanged.
INSERT INTO schema_migrations(version,applied_at) VALUES(8,datetime('now'));
