# ForkBasket product and implementation plan

ForkBasket is a mobile-first app for a family to share a shopping list, store recipes, and plan lunch for every day of the current and next week. The main shopping experience must be fast enough to use one-handed in the store. More detailed setup belongs in settings.

This document records the user’s requirements, the chosen direction, and the implementation boundaries. Keep it current as work proceeds. The current task is to bootstrap the project and deliver a few usable visual mockups, not to declare the entire production application complete.

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

The main screen uses large, easy-to-press tiles inspired by Bring. Pressing an item checks it and moves it to a recently checked section below the active list. Pressing a recently checked item brings it back. Keep a distinct edit control for notes and quantities so ordinary shopping remains one tap.

Adding an item should provide autocomplete from a substantial built-in catalog. Support creating custom items and assigning them to groups. Each item may have a photo or illustration, a quantity, and additional free text for an exact brand, color, size, variant, or instruction.

Adding ingredients from a recipe or weekly plan must avoid duplicate tiles and preserve required quantities. Sum compatible units; do not silently add unlike units. Preserve descriptions and reactivate checked items when they are needed again. Production handling should distinguish compatible products from materially different variants when a household wants separate items.

Required group coverage includes fruits, vegetables, milk, cheese, meat, fish, ingredients, spices, grain products, snacks, sweets, beverages, household, care, health, pet supplies, home, garden, bread, pastries, frozen, and convenience foods. The first mockup combines some adjacent groups for readability. Production catalog and store settings should support the full set, custom groups, and fine-grained ordering.

Settings should maintain a few favorite stores and a separate group order for each. The main screen includes a dropdown or autocomplete for the current store; switching stores immediately sorts the list to match that store’s aisles. Ingredient images and item images are optional attachments in the eventual data model.

## Recipes and weekly lunches

Store family recipes with a name, ingredients and amounts, instructions, servings, preparation time, optional tags, favorites, and an optional attached image. Support uploaded images and, when configured, AI-generated images through the appropriate provider capability.

Plan lunch for each day of the current and next week. A family member can select or replace a recipe, leave a day open, and add one recipe’s or the whole week’s ingredients to the shopping list. Scale quantities with servings. Allow users to omit ingredients they already have.

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

The current scaffold uses TanStack Start and a Rust Axum health endpoint. Proposed production persistence is SQLite for a first self-hosted household deployment, with migrations and a clear path to PostgreSQL if broader usage warrants it.

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

## Current progress

The bootstrap and interactive screens are complete. The repository contains TanStack Start routes for shopping, weekly lunches, recipes, and settings; 178 catalog products; sample recipes; local persistence and tab updates; a Rust health endpoint; generated API types; and a locked Nix environment. Food artwork is bundled as Twemoji SVGs so mockups render consistently on NixOS and mobile browsers.

Five shopping/calendar logic tests, the ts-rs export test, TypeScript checking, production compilation, Rust formatting and Clippy, Prettier checking, and the browser interaction suite have passed after a clean dependency install. Browser checks cover check/restore, descriptions, autocomplete, custom items, local persistence, same-browser tab updates, store sorting, ingredient quantity merging, next-week suggestions, store entry, recipe entry, and all four screens at 320, 390, 768, and 1440 pixels. Actual screenshots and the overview board are in `mockups/`; they have been visually reviewed. The API health endpoint was also verified through the frontend proxy.

The private repository is [FruitieX/forkbasket](https://github.com/FruitieX/forkbasket). The development preview runs at `http://localhost:3100`; the Rust scaffold listens at `127.0.0.1:3001`.

The next implementation milestone is **Shared household core**. Pattern learning and optional AI remain planned features. Read the production boundaries above before claiming the prototype is ready for real shared household use.
