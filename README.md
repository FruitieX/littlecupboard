# LittleCupboard

A shared family shopping list, recipe book and weekly lunch planner, ready to self-host. Mobile shopping stays one tap: large tiles, hold to edit, recently checked items below, and a searchable shop selector that orders the list by your usual aisles.

![LittleCupboard shopping, weekly lunches and recipes](mockups/overview.png)

Missing meal ingredients automatically join the list with a small source marker. Recipes support editing, favorites, tags, serving scaling, custom ingredients and private photos. Current/next-week lunches have serving counts and cooked/skipped feedback. Edit pantry quantities, units, notes and expiry directly in its dialog, or use conservative purchase estimates; the app keeps purchased meal ingredients reserved and releases them when plans change.

Settings links to separate pages for stores/aisle order, item groups, items and recipes. Search the item catalog and recipe book without opening accordions. Family/account details and backups stay on the main settings page. Archive catalog items to hide suggestions without breaking existing recipe ingredients; restore them later, or permanently delete unreferenced custom items. Shared deletions and AI disconnection require confirmation. AI connection setup and advanced prompts are collapsed and owner-only.

LittleCupboard is an installable PWA with a standalone manifest, app icons and an offline shell. On Android, open its HTTPS address in Chrome and choose **Add to home screen → Install**. The public homelab ingress allows synchronization outside the LAN/VPN; queued shopping changes survive offline use.

Accounts, expiring invitations, secure cookie sessions, SQLite transactions and SSE keep independent devices together. A persisted offline outbox and installable app shell keep shopping usable through connection loss. Concurrent edits get explicit review rather than overwriting another person’s changes. History supports guarded undo and shopping-trip completion.

Each item can have a saved consumption rate, such as 4 L every 7 days. Without one, compatible quantities bought on at least three separate days produce a labeled estimate that can be accepted or overridden in Settings → Items. Saved rates guide restock timing and AI suggestions; estimates do not silently reduce confirmed pantry stock. Shopping patterns produce explained restock suggestions after repeated purchases, with confidence, preferred descriptions/packages, store/day signals, product associations, snoozing and dismissal. Meal suggestions use favorites, ratings, rotation, dietary/ingredient preferences and likely ingredients. Discovery offers reviewed variations of saved recipes. Inventory is best effort, and estimates are distinguished from confirmed observations.

An optional assistant supports natural-language shopping, reviewed recipe drafts/variations, weekly plans and generated images. Generated icons and photos run as durable background jobs: a sleeping phone, closed dialog or page reload never fails them, and reopening the editor or the assistant shows the finished image to review and save. Imported recipes keep their supplied source images, filenames and original resolution in a collapsed Source images section; sources remain private and travel with backups. Suggestions close after the server confirms saving, while offline/failed saves retain their review controls. Recipe tags autocomplete existing names, allow new names and create shared filter chips for every tag. Settings offers an OpenAI-compatible API or a [personal Hermes companion](docs/HERMES-COMPANION.md), with chat model and reasoning controls. API keys are encrypted on the server; companion OAuth stays on the personal agent machine. The assistant is hidden until enabled.

Settings → AI assistant → Configure AI assistant → Compatibility & image generation offers optional automatic icons for new items and **Generate missing icons** for existing cart placeholders. Existing artwork is preserved. Generation runs in a durable server queue with progress, stop and retry controls; flat transparent icons are saved at 256 px. Automatic generation defaults off and uses your configured image provider's quota.

## Deploy

The homelab app is live at **https://littlecupboard.fruitiex.org** through the public and private Envoy gateways, with authenticated access to household data. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for Flux/SOPS setup, first-owner account, wife/member invitations, HTTPS/PWA behavior, AI compatibility, backups and upgrades.

```sh
nix build .#container
docker load < result
```

The image serves frontend and API in one Rust process on port 8080. Keep /data on persistent storage and set LITTLECUPBOARD_ORIGIN to the externally visited origin. WAL is the default for local/block storage; NFS requires LITTLECUPBOARD_SQLITE_JOURNAL_MODE=DELETE and reliable NFSv4 locking/sync. The supplied Kubernetes template uses one replica, Recreate, a block PVC, non-root permissions, public/private Envoy HTTPS routes and health probes. The live homelab instead uses the migrated NFS claim; see [the deployment guide](docs/DEPLOYMENT.md). Generate and SOPS-encrypt the deployment secrets before copying them into your homelab. Optional passkey sign-in through an OIDC provider is configured with `LITTLECUPBOARD_OIDC_*` variables; see [Passkey sign-in](docs/DEPLOYMENT.md#passkey-sign-in-oidc-optional).

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
nix develop --command python3 scripts/hermes-companion.check.py
nix develop --command npm run format:check
nix develop --command cargo fmt --manifest-path backend/Cargo.toml -- --check
nix develop --command cargo clippy --manifest-path backend/Cargo.toml -- -D warnings
nix develop --command cargo test --manifest-path backend/Cargo.toml
nix develop --command npm run build
nix develop --command npm run test:production
nix develop --command npm run test:oidc
nix build .#container
docker load -i result
nix develop --command npm run test:container
```

The browser suite starts isolated servers and temporary databases itself. It uses separate owner/wife sessions and checks live shopping, holds, persistence, offline reload/reconnect, photo uploads, recipe/custom-ingredient editing, multi-unit pantry editing with consecutive offline saves, saved/learned consumption rates, separate settings pages, serving changes, 80-shop autocomplete, per-device selection, configured AI proposals, background generation recovery across closed dialogs and reloads, and responsive layouts. Server tests cover authentication, idempotency, concurrency, guarded undo, automatic ingredients, pantry reservations, backups/recovery, learned intervals and controlled chat/image providers. Live AI configuration remains specific to your chosen endpoint and models.

After building, regenerate real production screenshots with `nix develop --command npm run mockups`. This uses an isolated test household and fixture provider, then removes the temporary data. Captures are in [mockups/](mockups/), with [an overview board](mockups/overview.html). Linux Chromium is supplied by the flake; on macOS supply a Playwright browser through PLAYWRIGHT_CHROMIUM_EXECUTABLE.

## Architecture

TanStack Start/Router, React, TypeScript, Tailwind, Radix Dialog, Motion and Lucide; Rust, Tokio, Axum, SQLite and ts-rs. Typed mutations operate atomically with idempotency keys and guarded changes; household SSE notices trigger authoritative snapshot refreshes. Images are decoded and stored privately in SQLite; display photos are optimized and source archives preserve resolution. The locked Nix flake builds backend, frontend and OCI packages without mutable base-image dependencies.

[docs/PLAN.md](docs/PLAN.md) preserves the requirements, accepted design and implementation decisions. [AGENTS.md](AGENTS.md) describes development and maintenance expectations.

## Asset credits

Food and household SVG illustrations are [Twemoji](https://github.com/twitter/twemoji), copyright Twitter and contributors, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The bundled license is in `public/images/food/LICENSE-GRAPHICS.txt`. They replace platform-dependent emoji rendering; the SVG graphics are unmodified. `backend/assets/item-style-reference.png` is a raster arrangement of six of those graphics for companion icon generation, reproduced by `scripts/render-item-reference.mjs`; its license is bundled alongside it.

DM Sans and Fraunces are bundled from [Google Fonts](https://github.com/google/fonts), with their SIL Open Font License files in `public/fonts/`.

Illustrative recipe photography is downloaded from Unsplash and bundled locally under the [Unsplash License](https://unsplash.com/license): [pasta](https://images.unsplash.com/photo-1473093226795-af9932fe5856), [salmon](https://images.unsplash.com/photo-1467003909585-2f8a72700288), [salad](https://images.unsplash.com/photo-1512621776951-a57141f2eefd), [tomato soup](https://unsplash.com/photos/tomato-soup-6eCpa9J3c_c), and [tacos](https://images.unsplash.com/photo-1551504734-5ee1c4a1479b). These photos illustrate the sample recipes rather than documenting their exact preparation.

## Brand assets

`public/icon.svg` is the editable cupboard mark, also used for the favicon and in-app wordmark. Run `nix develop --command npm run icons` to export deterministic 192/512 px opaque maskable PNGs. The mark stays inside Android's central safe area. Local working-directory and deployment compatibility details are in [DEPLOYMENT.md](docs/DEPLOYMENT.md).
