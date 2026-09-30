# ForkBasket project context

Read `docs/PLAN.md` before continuing implementation. It preserves the user’s requirements, accepted naming decision, architecture, scope, and remaining work. Update its progress section when a milestone finishes or a meaningful decision changes.

Use the locked Nix environment for project commands: `nix develop --command ...`. Verify the relevant tools inside it before building. Commit and push task changes after the relevant checks, as authorized by `/home/rasse/AGENTS.md`. Keep unrelated work untouched.

The current application is an interactive local prototype. Do not describe same-browser localStorage updates as cross-device household synchronization. Do not expose AI credentials to the browser. The production backlog, including server persistence, invitations, SSE, pattern learning, and optional AI, is recorded in the plan.

Keep shopping easy to use one-handed on mobile: pressing a tile checks it, holding it opens the edit dialog, and checked items remain recoverable and editable below the list. Support right-click and Shift+F10 for editing on desktop. Keep the main screen quiet; use a searchable store autocomplete, and automatically derive missing ingredients from upcoming meal plans with a small source marker. Preserve reduced-motion support and accessible labels. Take real browser screenshots when changing the visual direction.
