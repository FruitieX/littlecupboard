-- Guard private item photo references in household JSON against older strict
-- readers. Existing households have no item photos.
INSERT INTO schema_migrations(version,applied_at) VALUES(14,datetime('now'));
