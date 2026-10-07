-- Guard the automatic meal-feedback flag in household JSON against older
-- strict readers. Existing feedback defaults to not automatic.
INSERT INTO schema_migrations(version,applied_at) VALUES(13,datetime('now'));
