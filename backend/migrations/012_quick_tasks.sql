-- Guard optional quick-task model settings in provider JSON against older
-- strict readers. Existing configurations keep their behavior.
INSERT INTO schema_migrations(version,applied_at) VALUES(12,datetime('now'));
