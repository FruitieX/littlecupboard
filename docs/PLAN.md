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

The user accepted the initial visual direction but requested less clutter, especially on the shopping page. Prioritize the shop picker, item addition, grouped tiles, and recently checked entries. Hide secondary restock suggestions in an expandable section. Avoid promotional copy, sidebar cards, and repeated visual confirmations during ordinary checking.

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
