-- Guard the AI-added item markers in household JSON against older strict
-- readers. Existing households have no markers.
INSERT INTO schema_migrations(version,applied_at) VALUES(15,datetime('now'));
