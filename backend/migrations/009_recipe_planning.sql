-- Guard the optional recipe planning flag against older strict deserializers.
-- Missing flags retain legacy inclusion; existing recipes/plans are untouched.
INSERT INTO schema_migrations(version,applied_at) VALUES(9,datetime('now'));
