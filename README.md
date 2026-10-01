# ForkBasket

A shared family shopping list, recipe book and weekly lunch planner, ready to self-host. Mobile shopping stays one tap: large tiles, hold to edit, recently checked items below, and a searchable shop selector that orders the list by your usual aisles.

![ForkBasket shopping, weekly lunches and recipes](mockups/overview.png)

Missing meal ingredients automatically join the list with a small source marker. Recipes support editing, favorites, tags, serving scaling, custom ingredients and private photos. Current/next-week lunches have serving counts and cooked/skipped feedback. Confirm pantry amounts or use conservative purchase estimates; the app keeps purchased meal ingredients reserved and releases them when plans change.

Accounts, expiring invitations, secure cookie sessions, SQLite transactions and SSE keep independent devices together. A persisted offline outbox and installable app shell keep shopping usable through connection loss. Concurrent edits get explicit review rather than overwriting another person’s changes. History supports guarded undo and shopping-trip completion.

Shopping patterns produce explained restock suggestions after repeated purchases, with confidence, preferred descriptions/packages, store/day signals, product associations, snoozing and dismissal. Meal suggestions use favorites, ratings, rotation, dietary/ingredient preferences and likely ingredients. Discovery offers reviewed variations of saved recipes. Inventory is best effort, and estimates are distinguished from confirmed observations.

An optional OpenAI-compatible assistant supports natural-language shopping, reviewed recipe drafts/variations, weekly plans and generated images. Configure the endpoint and models later in Settings. Provider keys are encrypted on the server; the assistant is hidden until enabled.

## Deploy

The homelab app is live at **https://forkbasket.fruitiex.org** through the private Envoy gateway. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for Flux/SOPS setup, first-owner account, wife/member invitations, HTTPS/PWA behavior, AI compatibility, backups and upgrades.

```sh
nix build .#container
docker load < result
```

The image serves frontend and API in one Rust process on port 8080. Keep /data on persistent block/local storage and set FORKBASKET_ORIGIN to the externally visited origin. The supplied Kubernetes deployment uses one replica, Recreate, a block PVC, non-root permissions, a private Envoy HTTPS route and health probes. Generate and SOPS-encrypt the deployment secrets before copying them into your homelab.

## Develop

```sh
nix develop
command -v node npm cargo cc
npm ci
npm run dev
# In another Nix shell:
cargo run --manifest-path backend/Cargo.toml
```

Open http://localhost:3100. Vite proxies /api to 127.0.0.1:3001. The server creates a private data/setup-token file on first start; use it to create the owner account and save your recovery code. The list and history start empty, with five editable sample recipes available by choice. Runtime databases, keys and uploaded data are Git-ignored.

## Check the app

```sh
nix develop --command npm run typecheck
nix develop --command npm test
nix develop --command npm run format:check
nix develop --command cargo fmt --manifest-path backend/Cargo.toml -- --check
nix develop --command cargo clippy --manifest-path backend/Cargo.toml -- -D warnings
nix develop --command cargo test --manifest-path backend/Cargo.toml
nix develop --command npm run build
nix develop --command npm run test:production
nix build .#container
docker load -i result
nix develop --command npm run test:container
```

The browser suite starts isolated servers and temporary databases itself. It uses separate owner/wife sessions and checks live shopping, holds, persistence, offline reload/reconnect, photo uploads, recipe/custom-ingredient editing, pantry observations, serving changes, 80-shop autocomplete, per-device selection, configured AI proposals and responsive layouts. Server tests cover authentication, idempotency, concurrency, guarded undo, automatic ingredients, pantry reservations, backups/recovery, learned intervals and controlled chat/image providers. Live AI configuration remains specific to your chosen endpoint and models.

After building, regenerate real production screenshots with `nix develop --command npm run mockups`. This uses an isolated test household and fixture provider, then removes the temporary data. Captures are in [mockups/](mockups/), with [an overview board](mockups/overview.html). Linux Chromium is supplied by the flake; on macOS supply a Playwright browser through PLAYWRIGHT_CHROMIUM_EXECUTABLE.

## Architecture

TanStack Start/Router, React, TypeScript, Tailwind, Radix Dialog, Motion and Lucide; Rust, Tokio, Axum, SQLite and ts-rs. Typed mutations operate atomically with idempotency keys and guarded changes; household SSE notices trigger authoritative snapshot refreshes. Uploaded/generated images are decoded, resized and stored privately in SQLite. The locked Nix flake builds backend, frontend and OCI packages without mutable base-image dependencies.

[docs/PLAN.md](docs/PLAN.md) preserves the requirements, accepted design and implementation decisions. [AGENTS.md](AGENTS.md) describes development and maintenance expectations.

## Asset credits

Food and household SVG illustrations are [Twemoji](https://github.com/twitter/twemoji), copyright Twitter and contributors, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The bundled license is in `public/images/food/LICENSE-GRAPHICS.txt`. They replace platform-dependent emoji rendering; the graphics themselves are unmodified.

DM Sans and Fraunces are bundled from [Google Fonts](https://github.com/google/fonts), with their SIL Open Font License files in `public/fonts/`.

Illustrative recipe photography is downloaded from Unsplash and bundled locally under the [Unsplash License](https://unsplash.com/license): [pasta](https://images.unsplash.com/photo-1473093226795-af9932fe5856), [salmon](https://images.unsplash.com/photo-1467003909585-2f8a72700288), [salad](https://images.unsplash.com/photo-1512621776951-a57141f2eefd), [tomato soup](https://unsplash.com/photos/tomato-soup-6eCpa9J3c_c), and [tacos](https://images.unsplash.com/photo-1551504734-5ee1c4a1479b). These photos illustrate the sample recipes rather than documenting their exact preparation.
