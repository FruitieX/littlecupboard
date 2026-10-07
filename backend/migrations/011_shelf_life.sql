-- Guard optional per-item shelf life JSON against older strict state readers.
-- Existing households are untouched; a missing map means no shelf lives.
INSERT INTO schema_migrations(version,applied_at) VALUES(11,datetime('now'));
