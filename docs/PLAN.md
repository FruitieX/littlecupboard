# ForkBasket product and implementation plan

ForkBasket is a mobile-first app for a family to share a shopping list, store recipes, and plan lunch for every day of the current and next week. The main shopping experience must be fast enough to use one-handed in the store. More detailed setup belongs in settings.

This document records the user’s requirements, the chosen direction, and implementation progress. Keep it current as work proceeds. The user has now authorized completing the full polished homelab application in one sustained goal, including accounts for both adults, AI, and every discussed feature. The original prototype milestones below are historical; they do not limit the current scope or authorize deferring features.

## Decisions and context

- Project: `/home/rasse/forkbasket`.
- Name: **ForkBasket**. MealBasket was the first choice but is already used by a closely related app. The user then suggested PrepBasket, with ForkBasket as the fallback; preliminary searches found PrepBasket used for a kitchen product, so the fallback was selected. No matching ForkBasket app appeared in the initial web searches. This is a preliminary name search, not a claim of exclusivity.
- Household: the user, wife, and kids. Collaboration must work on separate devices simultaneously.
- Frontend preference: TanStack Start, TypeScript, Tailwind CSS, and Radix or similar accessible components.
- Backend preference: Rust, Tokio, Axum, and ts-rs for shared API types.
- Environment: NixOS; use the project’s locked Nix flake, verify tools inside it, and use committed npm and Cargo lockfiles.
- Standing user instruction: after relevant checks, commit task changes and push to the remote. Do not include unrelated changes.
- Current design direction: warm ivory, forest green, gentle pastel food tiles, expressive food illustrations, recipe photography, friendly serif headings, and restrained animations.

## Shopping list requirements

The main screen uses large, easy-to-press tiles inspired by Bring. Pressing an item checks it and moves it to a recently checked section below the active list. Pressing a recently checked item brings it back. Holding an active or checked entry opens its edit dialog. Right-click and Shift+F10 provide desktop and keyboard equivalents. Cancel a pending hold when the user scrolls or moves away. Keep ordinary shopping one tap and remove separate pencil buttons from tiles.

The user accepted the initial visual direction but requested less clutter, especially on the shopping page. Prioritize the shop picker, item addition, and recently checked entries. Shopping now defaults to a continuous tile grid, sorted by store category/aisle order. Category headings and separate grids are optional through Settings → Shopping list → Group by category, with an account-specific device preference. Hide secondary restock suggestions in an expandable section. Avoid promotional copy, sidebar cards, and repeated visual confirmations during ordinary checking.

Adding an item should provide autocomplete from a substantial built-in catalog. Support creating custom items and assigning them to groups. Each item may have a photo or illustration, a quantity, and additional free text for an exact brand, color, size, variant, or instruction.

Adding ingredients from a recipe or weekly plan must avoid duplicate tiles and preserve required quantities. Sum compatible units; do not silently add unlike units. Preserve descriptions and reactivate checked items when they are needed again. Production handling should distinguish compatible products from materially different variants when a household wants separate items.

Required group coverage includes fruits, vegetables, milk, cheese, meat, fish, ingredients, spices, grain products, snacks, sweets, beverages, household, care, health, pet supplies, home, garden, bread, pastries, frozen, and convenience foods. The first mockup combines some adjacent groups for readability. Production catalog and store settings should support the full set, custom groups, and fine-grained ordering.

Settings should maintain favorite stores and a separate group order for each. The main screen must include a searchable autocomplete for the current store because the configured list may be long. Search names and locations, support touch and keyboard selection, and preserve the chosen shop if the search is canceled. Switching stores immediately sorts the list to match that store’s aisles. Ingredient images and item images are optional attachments in the eventual data model.

## Recipes and weekly lunches

Store family recipes with a name, ingredients and amounts, instructions, servings, preparation time, optional tags, favorites, and an optional attached image. Support uploaded images and, when configured, AI-generated images through the appropriate provider capability.

Plan lunch for each day of the current and next week. A family member can select or replace a recipe or leave a day open. Missing planned ingredients must automatically appear in the shopping list with a subtle “Meal plan” marker; there is no “Shop this week” button. Explicitly adding one recipe’s ingredients remains available from recipe detail. Scale quantities with servings. Allow users to omit ingredients they already have.

The prototype derives requirements for today through the end of next week. Sum each product’s compatible amounts across planned meals, then treat manually listed quantities as coverage rather than adding the same requirement twice. Keep unlike units as distinct amounts on one tile. Checking credits the specific current meal requirements so groceries do not repeatedly return after reloads or unrelated edits; restoring undoes the last check’s credits. A later meal or increased requirement can add more. Removing a planned ingredient skips the current requirements while allowing future additions. Changing/removing a meal removes obsolete automatic entries while preserving manually added groceries and notes. Note-only edits continue following the plan; explicitly changing a quantity overrides current requirements and adopts the chosen amount as a manual grocery, including when the amount is smaller. These credits are best-effort meal coverage, not exact pantry inventory. Production should reconcile them with confirmed pantry observations and durable purchase events.

Suggest a weekly schedule from saved recipes. Initial deterministic suggestions can favor overlapping ingredients, reasonable preparation times, varied meals, and favorite recipes. Production suggestions should also use household preferences, cooking history, likely inventory, and feedback. A recipe suggested by an AI assistant is a draft until the family chooses to save it.

## Learning household patterns

The user explicitly requested learning from meal and shopping patterns, optionally with AI, and suggesting new things to try. Make this part of the product architecture rather than an isolated chatbot feature.

Capture durable household events with timestamps, store, actor, item or recipe identity, and applicable quantity: item added, checked, restored or removed; shopping trip completed; recipe planned, replaced, favorited or marked cooked; suggestion accepted, edited, dismissed or snoozed. Do not treat a planned meal as a cooked meal. A checked grocery is a likely purchase, and the user must be able to correct it.

Use simple, inspectable signals first:

- Estimate restocking intervals from repeated purchases, using robust intervals and confidence rather than a fixed assertion that an item is empty.
- Learn preferred brands, package sizes, stores, common shopping days, and products bought together.
- Learn meal frequency, favorites, weekday preparation-time patterns, serving sizes, and recipes frequently replaced or skipped.
- Rotate familiar meals to avoid repetition, and reuse ingredients to reduce waste.
- Suggest a few new meals or products adjacent to accepted favorites, alongside familiar options. Let the household choose the degree of variety.
- Explain suggestions with actual evidence: “usually bought every 7 days,” “not cooked for 3 weeks,” or “uses spinach already on the list.” Allow dismissal, snoozing, correction, and history reset.

Inventory is best effort. Purchases add estimated availability; cooking can decrement known ingredients if the family confirms it. Consumption between meals, waste, and purchases outside the app remain uncertain. Show “likely available” and “worth checking,” never imply an exact stock count from guesses. A manually confirmed pantry amount overrides estimates.

An optional AI layer can turn these signals into household-friendly meal plans, identify common themes in favorite recipes, propose variations and new recipes, and help compile shopping additions. Provide relevant summaries instead of shipping complete household history by default. Keep deterministic replenishment and planning usable without AI.

## Optional AI assistant

Support OpenAI-compatible base URLs, API keys, model selection, and connection validation through settings. Configuration belongs on the backend; never ship provider secrets to the browser or store them in localStorage. Treat image generation as a separate optional provider capability since not every compatible chat endpoint supports it.

Hide the assistant in ordinary navigation until the household has a configured provider. Its capabilities should include natural-language shopping additions, restock help, recipe drafting, variants of existing recipes, and weekly planning. Return typed proposals for ingredient amounts, product matches, new recipes, and schedule changes. Let users review proposals before changing their lists or saving recipes. Enforce household access when calling tools and validating model output.

## Production architecture

Production uses a TanStack Start SPA shell served by Rust/Axum, with household snapshots, accounts, operations, history, private images and encrypted provider configuration persisted in SQLite. Migrations and transactional writes support the first self-hosted family deployment.

Core records: household, member, invitation, product, product alias and variant, group, store, store group order, shopping list and item, purchase event, pantry observation, recipe, recipe ingredient, image attachment, daily meal plan, cooked meal, suggestion, suggestion feedback, and server-side provider configuration.

Use authenticated household-scoped mutations and a server-authoritative event stream. SSE is a suitable starting point: ordinary HTTP mutations plus SSE notifications simplify reconnection and work well for shopping collaboration. Each operation needs an idempotency key and version information. Persist changes before broadcasting. Use optimistic UI, visible connection state, reconnect backoff, and recovery from a missed event cursor. Concurrent quantity changes and edits need explicit reconciliation; whole-state localStorage replacement is not a production sync design.

Keep provider calls, credentials, uploaded attachments, and event history on the backend. Generate TypeScript response/request types from Rust with ts-rs. Validate inputs on the server even when the frontend already validates them.

## Bootstrap deliverables

The first milestone delivers:

- Locked Nix development environment and Git repository.
- TanStack Start application with shopping, week planner, recipe book, recipe detail, recipe entry, and store settings views.
- Mobile and desktop layouts, reduced-motion support, large shopping targets, and accessible dialogs.
- Seed product catalog and recipe data, local persistence, same-browser tab updates, store ordering, item edits, check/restore, recipe quantity merging, and deterministic plan suggestions.
- Rust Tokio/Axum service scaffold with health endpoint and ts-rs type export.
- Actual browser screenshots, an overview presentation, and reproducible screenshot scripts.
- Appropriate unit tests, mobile browser checks, TypeScript/build validation, Rust checks, and committed/pushed changes.

Boundary: authentication, durable shared server state, cross-device realtime sync, production inventory learning, AI provider connections, and production image storage are **not implemented by the visual bootstrap**. The UI must not claim these work. The mockup uses localStorage, sample history, sample household avatars, and stock recipe photography. Resetting demo data removes the local preview changes.

## Implementation phases

1. **Bootstrap and design:** complete the deliverables above, review the visual direction, and record validation results.
2. **Shared household core:** database migrations, authentication/invitations, typed list and recipe APIs, store settings, attachments, and SSE with reconnection and concurrent-use tests.
3. **Shopping reliability:** mobile polish, offline queue, duplicate variant handling, undo, trip completion, catalog expansion and aliases, and pantry observations.
4. **Pattern learning:** durable purchase/cooking events, confidence-based restock estimates, preference signals, deterministic explanations, and suggestion feedback.
5. **Optional assistant and discovery:** server-side OpenAI-compatible configuration, structured tools, reviewed proposals, new recipes, controlled novelty, and optional generated images.
6. **Deployment and family use:** self-hosted configuration, backups, observability, installable mobile/PWA behavior, and real household feedback.

## Questions to resolve before production

These do not block the bootstrap. Defaults can be chosen for the first family deployment and adjusted with the user:

- Preferred self-hosting target and household sign-in/invitation method.
- English, Finnish, or bilingual catalog and UI; aliases for common grocery terms.
- Dietary preferences, ingredient exclusions, and how the family wants to provide meal feedback.
- Whether checking alone marks a purchase or a completed trip confirms it.
- Whether cooking should require a confirmation before reducing estimated pantry stock.
- Desired offline behavior, shared-device support for kids, and history retention.
- Provider/base URL, model, and image-generation capability, if any.

## Prototype progress (historical)

The bootstrap and interactive screens are complete. The repository contains TanStack Start routes for shopping, weekly lunches, recipes, and settings; 178 catalog products; sample recipes; local persistence and tab updates; a Rust health endpoint; generated API types; and a locked Nix environment. Food artwork is bundled as Twemoji SVGs so mockups render consistently on NixOS and mobile browsers.

Five shopping/calendar logic tests, the ts-rs export test, TypeScript checking, production compilation, Rust formatting and Clippy, Prettier checking, and the browser interaction suite have passed after a clean dependency install. Browser checks cover check/restore, descriptions, autocomplete, custom items, local persistence, same-browser tab updates, store sorting, ingredient quantity merging, next-week suggestions, store entry, recipe entry, and all four screens at 320, 390, 768, and 1440 pixels. Actual screenshots and the overview board are in `mockups/`; they have been visually reviewed. The API health endpoint was also verified through the frontend proxy.

The private repository is [FruitieX/forkbasket](https://github.com/FruitieX/forkbasket). The development preview runs at `http://localhost:3100`; the Rust scaffold listens at `127.0.0.1:3001`.

The accepted prototype refinements are implemented: a quieter shopping page, automatic upcoming meal ingredients and quantity top-ups, a small “Meal plan” source marker, long-press editing for active and checked entries, and searchable shop selection by name/location. Compatible units are normalized, incompatible amounts remain visible, checked requirements survive reloads, and changes to meals preserve manual groceries. All 15 unit tests pass, including purchase/restore, skipped ingredients, explicit quantity overrides, custom recipes, migration from existing local data, and plan changes. Mobile browser checks include actual touch holds, keyboard editing, automatic additions across tabs, and autocomplete with more than 80 configured shops. Screenshots are refreshed for this direction.

## Full application delivery

Complete all phases in this goal; do not stop at the household core or postpone AI. Ship reproducible deployment and validated behavior, not just UI placeholders. Defaults: SQLite, account/password login with first-owner setup and expiring invitations, same-origin secure cookies, a Kubernetes/FluxCD/SOPS deployment matching ~/homelab, with a private Envoy HTTPS route and block-storage SQLite PVC, and configurable OpenAI-compatible chat/image providers. Ask about hosting/provider preferences without blocking independent work. Provider credentials and a live homelab are external configuration; test against controlled provider fixtures and the local production package when they are unavailable.

Acceptance checklist:

- [x] Durable household persistence, migrations, atomic operations, revision checks, idempotency and backup/restore.
- [x] First-owner setup, login/logout, wife/member invitations, account/profile management, password changes/recovery, household isolation and server validation.
- [x] Authenticated SSE across independent devices, reconnect recovery, optimistic shopping, offline operation queue and installable PWA.
- [x] Quiet mobile shopping, tap/check/restore and long-press editing, meaningful undo/trip history, quantities/variants/notes, product/item images, large searchable catalog, complete and custom groups.
- [x] Favorite stores, autocomplete, per-store group ordering and local current-store preference.
- [x] Recipe create/read/update/delete, favorites, search/tags, ingredients including custom products, quantity scaling, image uploads and generated images.
- [x] Current/next-week daily lunches, serving counts, replacements, automatic missing ingredients, pantry coverage, cooked/skipped feedback and explained weekly suggestions.
- [x] Best-effort pantry with confirmed observations, purchase/cooking adjustments, history correction and estimates visibly distinguished from confirmations.
- [x] Learned replenishment intervals/confidence, brands/pack sizes/stores/shopping days/product associations, meal rotation/preferences and discovery, dismissal/snooze/feedback/reset.
- [x] Server-side OpenAI-compatible setup/test/models, hidden-until-configured assistant, natural-language shopping, reviewed typed proposals, new/variant recipes, weekly plans and optional image generation.
- [x] Polished responsive views, errors/loading/offline states, accessibility/reduced motion and real browser screenshots.
- [x] Production build/deployment, health/readiness, reverse-proxy guidance, persisted volumes, secure bootstrap/secrets, upgrades/backups, meaningful API/browser/concurrency/offline/AI tests, committed and pushed changes.

The full implementation is complete. Release checks cover the production browser app, isolated provider fixtures, the actual Nix-built container and compiled Kubernetes templates. Delivery includes commit/push and successful CI image publishing. On 2026-10-01 the user explicitly authorized live homelab deployment; the deployment checkpoint below records the result.

### Full application implementation checkpoint

The household API and production frontend are implemented. This is now a real shared application, replacing local prototype storage with SQLite transactions, hashed cookie sessions, expiring member invitations, SSE notifications, optimistic idempotent operations, guarded edits and history undo. First-owner setup is protected by a server token. Recovery codes, password changes, owner/member access, private image uploads, household backups and atomic restoration are implemented. Rust exports API types.

Shopping uses the accepted quiet tile layout and gestures, a catalog of 333 items in all 22 requested groups, custom groups and products, per-device searchable shop selection, and per-store ordering. Product pictures and group overrides persist. Recipes can be created, edited, deleted, favorited, searched, scaled, and photographed; ingredient entry accepts custom products. Meals have serving counts and cooked/skipped feedback. Missing current/next-week requirements follow pantry observations and purchase credits; stale offline quantities require review, and removed/skipped meals release purchased reservations into estimated pantry. Offline pantry confirmations reserve purchased meal ingredients before applying the remainder elsewhere.

Purchase events drive robust replenishment intervals, confidence labels, package/description preferences, store and shopping-day signals, and product associations. Suggestions support acceptance, snooze, dismissal and reset. Recipe ranking uses rotation, favorites, ratings, preferences and ingredient overlap; a reviewed variation provides deterministic discovery alongside AI recipe suggestions. Inventory remains visibly estimated unless manually confirmed.

AI keys are encrypted on the backend with a persisted application key. Configurable compatible Chat Completions providers support schema, JSON and prompted-JSON modes, model discovery/testing, typed reviewed shopping/recipe/week proposals, and optional compatible image generation. Unconfigured assistants are hidden. Provider fixtures validate chat and image behavior; no live provider key was supplied.

Production uses TanStack Start SPA prerendering, an installable service worker and persisted per-tab offline outboxes. Abandoned outboxes can be recovered using browser locks. Axum serves the compiled frontend and API in one process. The locked Nix OCI image runs as UID 10001 with a read-only root filesystem. CI validates the app and publishes the image to GHCR. Flux manifests match the homelab's private Envoy gateway, SOPS configuration and `syno-storage` block PVC, with one replica and Recreate deployment. The live homelab was unchanged at initial application delivery; it was subsequently deployed at the user's explicit request.

Release validation: TypeScript, formatting, Clippy, 18 frontend tests and 37 Rust tests pass (15 behavior tests plus 22 typed-binding exports). The production browser suite passes separate owner/wife sessions, live check/restore/hold-edit, automatic ingredients across reload, offline addition/reload/reconnect, private photo persistence, recipe/custom-ingredient editing, pantry confirmation, serving changes, skipped-meal stock release, 80-shop autocomplete/device-local selection, provider configuration/testing and reviewed AI additions. All views fit 320/390/768/1440 px. Mobile group wrapping and meal controls were corrected after visual review; actual screenshots are refreshed in `mockups/`.

The Nix container builds successfully. Runtime checks verify non-root/read-only operation, SPA deep routes, authentication, persistent list/account data after restart, private consistent online database backups, refusal to overwrite backups and point-in-time restoration into a separate data directory. Kustomize compiles the deployment, service, private HTTPS route, block PVC and secret template. Deployment documentation covers bootstrap/invitations, provider compatibility, offline behavior, backups, restoration and upgrades. Live provider configuration and applying the reviewed templates to the user's cluster are installation steps, not missing app features.

### Homelab deployment checkpoint — 2026-10-01

User authorization: deploy into `~/homelab` using private ingress. The homelab changes were validated, committed and pushed as `dd3f091`. Flux reconciled the app successfully. The tested image is pinned to `sha256:673c7c6897e1bb268938497f3b46f637d017d010660df295579c9e4759b4023b`; the deployment uses existing GHCR credentials and freshly SOPS-encrypted setup/encryption secrets. SQLite resides on a bound 5 GiB `syno-storage` PVC; PVC pruning is disabled, and the storage class retains its PV.

The app is healthy at `https://forkbasket.fruitiex.org`. DNS resolves to the private Envoy gateway at `192.168.11.99`; its route is Accepted/ResolvedRefs and the public gateway returns 404. A real mobile browser verified trusted HTTPS, the first-owner form and absence of runtime errors. Owner/wife accounts and live AI configuration remain owner setup steps; no accounts or provider credentials were invented. First-login and operations instructions are saved in `~/homelab/apps/forkbasket/README.md`.

### NFS and shopping presentation update — 2026-10-01

The user requested migrating existing data to NFS and defaulting to aisle-sorted tiles without category grouping. The app supports `FORKBASKET_SQLITE_JOURNAL_MODE=DELETE` with synchronous EXTRA for NFS, while preserving WAL as the default for local/block storage. One replica with Recreate remains required. Shopping has a continuous sorted grid by default and an account/device-specific Group by category preference in Settings. Both layouts preserve store ordering, item colors, automatic ingredient markers, check/restore and editing gestures. The migration uses the existing `nfs-csi` class and a new `forkbasket-data-nfs` claim; the old iSCSI claim is retained. The stopped-data migration checks full SQLite integrity and hashes every table's schema/content, including image blobs and credentials, before switching the Deployment. Live results are documented in the homelab README after cutover.

The cutover is complete. Release `296304a` passed full CI and published digest `sha256:62bd4dee085a306ad7a847106143ead873a4f6cdc8f86bd6449b954411716f5b`. Homelab commit `3ba43a7` pins that image and switches `/data` to `/volume3/homelab/forkbasket-data-nfs` on nectarine. Flux was suspended during the stopped-volume copy and resumed only after the new Git revision was available; it reports Ready on the deployed revision. The copier and a subsequent live online backup both passed full SQLite integrity checks and have identical schema/content hash `babef21cd8e3a29fbb6671aa5f6c7492a855cdc253e0f8cb89dcecf9f58a577e`, preserving two accounts, two sessions, one household and all 14 events/operations. The original iSCSI claim and a private pre-migration backup remain intact. The running pod uses the NFS CSI driver, DELETE mode and the exact published digest; no WAL/SHM files remain in `/data`. Trusted private HTTPS, preserved login/setup status, the new frontend bundle and a mobile browser without runtime errors were verified. Frontend tests (18), Rust tests (38), production two-device/offline/AI browser checks, Nix packaging and container restart/backup/restore checks all passed. Updated shopping/settings screenshots show the continuous grid and optional grouping preference.

The user subsequently authorized deleting the old iSCSI volume. Its manifest and one-time migration helpers were retired in homelab commit `e6a6c89`; the helpers remain available in Git history. The active NFS claim and private pre-migration backup are preserved. Subscription setup was reviewed against current official documentation: the current assistant accepts API credentials; ChatGPT plan usage would need a new OAuth/Responses integration, and the documented plan-usage preview does not support image generation. No subscription tokens or API credentials were copied or configured.

### Settings layout correction — 2026-10-01

Desktop settings now use two equal columns instead of a fixed narrow sidebar, giving kitchen, AI and account forms the same room as store settings. The columns stack at 1120 px and below. Form controls can shrink within their cards, long text wraps, and action buttons wrap onto another row when needed. The production browser suite checks expanded AI compatibility/image settings at 320, 390, 768, 1020, 1120, 1121, 1240, 1440 and 1920 px, asserting that controls stay inside their cards and desktop forms have balanced widths. Real desktop/mobile screenshots were reviewed. All 18 frontend tests, TypeScript, formatting, the production build and the full two-device/offline/AI browser suite pass. This correction is a source change; the live homelab image has not been updated as part of this task.

### Subscription integration investigation — 2026-10-01

The user requested investigating a proper Codex/ChatGPT integration. [CHATGPT-INTEGRATION.md](CHATGPT-INTEGRATION.md) records current official guidance, deployment boundaries and a concrete adapter/onboarding/worker plan. A real local stdio probe against Codex 0.159.3 and the existing ChatGPT login returned a valid schema-constrained shopping proposal in 7 seconds and a native generated PNG in 30 seconds. Native `imageGeneration` completion includes a saved path; the 944,399-byte PNG was verified. This corrects the overly broad earlier implication that subscription images are impossible. The public SIWC Responses route still excludes image generation, while native Codex-managed authentication has separate documented limits for hosted services. No credentials were copied into ForkBasket and no subscription connector was deployed. A permitted production route and per-person connection ownership must be settled before implementation; the successful local probe alone does not establish permission to offer a shared Codex-backed web service.

### Direct ChatGPT sign-in and image availability — 2026-10-01

The standalone `scripts/siwc-probe` now tests app-owned OAuth with dynamic registration, a stable host ID, a loopback callback through an SSH tunnel, PKCE/state/nonce, JWKS-backed identity verification and explicit plan-use scope checks. Its independently locked `jose` dependency does not change the application dependencies. Five negative/security/stream checks pass and run in CI.

The user's real browser consent succeeded. Public subscription model discovery and a streamed `gpt-6-astra` text request completed successfully. A second consent reused the registered client, repeated text successfully and attempted the hosted image-generation tool through Responses. Images were rejected with HTTP 400 `subscription_sharing_unsupported_capability`. Both test sessions were revoked successfully; no tokens were saved, copied from Codex or configured in production. Registration metadata and sanitized results remain outside Git. This establishes technical subscription-text access for the tested account/registration and confirms that SIWC images are unavailable on that route; the prior native Codex image trial remains a separate successful path. The deployed app still needs its subscription-text adapter and, for subscription images, the proposed personal native Codex companion. Private/remote eligibility and per-person connection ownership remain part of that implementation design. See [CHATGPT-INTEGRATION.md](CHATGPT-INTEGRATION.md).

### Hermes image companion access check — 2026-10-01

The user is considering a 24/7 Hermes agent outside the homelab as an image companion. Pear already has an installed Hermes runtime and its CLI reports an existing Codex login; no credential transfer is required for local testing. `scripts/probe-hermes.mjs` uses Hermes's own managed runtime and invokes its native Codex image provider without changing settings or falling back to paid providers. Availability checks succeeded, but the first real shopping-icon request returned HTTP 401. No image was generated; recipe/reference requests were skipped. A fresh Hermes-owned sign-in was requested as the next diagnostic step. [CHATGPT-INTEGRATION.md](CHATGPT-INTEGRATION.md) records the exact setup commands, remote SSH/profile access requirements, and the proposed scoped queue/upload bridge. This failure is distinct from SIWC's HTTP 400 unsupported-image restriction and from the earlier successful native Codex-client image trial. No companion is deployed.

Account selection was subsequently clarified: the user is temporarily using their company Codex account for this coding session with permission, but ForkBasket AI runtime tests and services must use their personal account. Preserve the active company Codex session. A fresh Hermes `forkbasket` profile has been created on Pear without cloned credentials, shell aliases or changing the default. It must own exactly one personal OAuth entry labeled `personal`; do not mix company/personal accounts in a rotating pool or rely on root-profile auth fallback. The probe now requires `--profile forkbasket` and pins credential selection to the explicitly owned local entry, refusing missing/ambiguous logins and borrowed company credentials. The earlier unscoped login command is superseded by the profile-scoped instructions in the integration document.

Personal sign-in completed and all three bounded image trials succeeded: shopping artwork (27.2 s, 1254 × 1254), recipe photography (25.9 s, 1374 × 1145), and reference-guided matching artwork (33.1 s, 1254 × 1254). PNG decoding and visual inspection passed. The `forkbasket` profile selects `openai-codex` with `gpt-image-2-medium`; only the local profile configuration changed. Generated assets remain ignored, and no default/CLI credentials were removed despite Hermes's duplicate-account warning. A production companion queue/upload bridge remains to be implemented; this successful local test does not change the documented hosted-service authentication boundary.

### Lunch suggestion readability — 2026-10-01

Suggest lunches now puts its explanation beneath each meal title, with fixed day/image columns and all remaining width available to the text. Titles stay at 14 px on mobile and wrap as needed, instead of shrinking beside the explanation. The production browser suite verifies title width, font size, explanation placement and overflow at 320, 390, 768 and 1440 px; actual mobile screenshots were visually reviewed. TypeScript, all 18 frontend tests, production build and the full household/offline/AI browser suite passed.

### Personal companion implementation — 2026-10-01

The user explicitly requested configuring ForkBasket with the personal credentials and implementing Hermes support if needed, then selected `gpt-6-luna` with `xhigh`. The app now has an opt-in companion transport and model/reasoning controls. A household-scoped, revocable hashed worker token authorizes only outbound job claim/completion and heartbeat endpoints; ChatGPT credentials remain on Pear. A SQLite migration adds bounded, leased, expiring jobs, and a worker inside Hermes's managed runtime pins personal auth for native chat/images, refreshes only that entry and never falls back. The existing reviewed-proposal and private-image flows are reused. Administrative pairing and settings pairing are supported. [HERMES-COMPANION.md](HERMES-COMPANION.md) documents setup, security, service operation and limitations.

A real synthetic-household test passed `gpt-6-luna` / `xhigh` chat, schema-constrained grocery proposals without applying them and native generation saved as a private image; unauthenticated image access was denied. Mobile/desktop companion settings were checked separately after fixing accessible selector names, avoiding additional provider calls. The existing production household/offline/AI browser suite passed, including masked pairing/revocation and model/reasoning controls across four widths. All 39 Rust tests, 18 frontend tests, four offline companion protocol checks, TypeScript, formatting and Clippy passed. A persistent personal-only user service is defined and activated through Home Manager in `~/nixos-config`; its synthetic-household online/browser checks passed with the authentication files blocked and runtime cache writes allowed. Production rollout/pairing remains the next installation step. The lunch fix itself reached the live cluster as `7a5f5ee` through successful CI and automatic Flux deployment.

### Automatic deployment — 2026-10-01

The user selected deployment after every successful main build. The workflow follows `~/add-bot-rs`: validate/build/test/publish, send an `image-update` repository dispatch with the registry digest and source SHA, then commit the live image in homelab for Flux. ForkBasket's receiver updates only its Deployment, leaving historical migration records intact, and serializes image-update commits. The sender skips outdated main builds; PRs and tags do not deploy. ForkBasket needs `HOMELAB_DISPATCH_TOKEN`, a fine-grained PAT limited to homelab with Contents read/write; the token currently exists only in the user's 1Password. No credential was extracted or copied. Until that GitHub Actions secret is installed, builds publish successfully but warn and skip deployment. [DEPLOYMENT.md](DEPLOYMENT.md) documents activation, verification and direct 1Password-to-GitHub transfer. The user is considering a separate agent vault with a read-only 1Password service account; no 1Password integration was installed.

Activation subsequently completed. The user's NixOS repository was renamed to `~/nixos-config`; it now installs the locked 1Password CLI and `op-agent`/`with-op-agent`, with an encrypted GPG-only service-account credential provisioned by SOPS into a mode-0600 runtime file. The masked setup helper encrypts/verifies in memory without plaintext files or token arguments. Wrappers isolate personal CLI configuration and inherited Connect/session credentials, disable caching/debugging/biometric integration, validate ownership/permissions and export the token only to explicit child processes. Live checks established service account `ai-agents`, a single accessible vault `Agents`, and no globally exported token. The fine-grained homelab dispatch PAT was transferred directly into ForkBasket's GitHub secret. Rerunning only the deployment job of already-tested CI run `36859086838` succeeded; receiver run `36860915497` committed image `cfba1c45318666c25b4e42ebcd606a1bdc34aa01@sha256:b524336ceca98ad39d9b37413187c3cecef0ec4f90f508d80ac8941a7120cf74` in homelab commit `dcfe140`. Flux automatically reached Ready/Healthy with one ready replica at that revision. The NFS claim and private route are preserved; the desktop settings fix is included. Automatic deployment is now active. The user should keep the service-account token's backup entry in a private vault rather than Agents; same-user secret access is not an OS sandbox.
