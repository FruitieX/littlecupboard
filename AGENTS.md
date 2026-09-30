# ForkBasket project context

Read `docs/PLAN.md` before continuing implementation. It preserves the user’s requirements, accepted naming decision, architecture, scope, and remaining work. Update its progress section when a milestone finishes or a meaningful decision changes.

Use the locked Nix environment for project commands: `nix develop --command ...`. Verify the relevant tools inside it before building. Commit and push task changes after the relevant checks, as authorized by `/home/rasse/AGENTS.md`. Keep unrelated work untouched.

The application now uses durable household-scoped SQLite state, authenticated accounts, idempotent operations, SSE and a persisted offline outbox. Production is a TanStack Start SPA shell served by Axum in one unprivileged container. Preserve private server-side AI secrets and image access. Maintain server/client quantity semantics together, generated Rust API types and realistic two-device production browser checks. The homelab deployment templates are under deploy/kubernetes; modifying this repo does not authorize deploying the user's live Flux cluster. Read docs/DEPLOYMENT.md for packaging, recovery and backups.

Keep shopping easy to use one-handed on mobile: pressing a tile checks it, holding it opens the edit dialog, and checked items remain recoverable and editable below the list. Support right-click and Shift+F10 for editing on desktop. Keep the main screen quiet; use a searchable store autocomplete, and automatically derive missing ingredients from upcoming meal plans with a small source marker. Preserve reduced-motion support and accessible labels. Take real browser screenshots when changing the visual direction.
