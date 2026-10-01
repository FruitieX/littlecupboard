# Personal Hermes companion

ForkBasket can use a personal Hermes profile for ChatGPT/Codex chat and native image generation. In Settings choose **Personal Hermes companion**. Chat model and reasoning effort are independent settings; the requested initial configuration is `gpt-6-luna` / `xhigh`, with `gpt-image-2-medium` for images. This is an opt-in personal integration using Hermes's native backend, not SIWC or an OpenAI API key. The native route's hosted-service support boundary is documented in [CHATGPT-INTEGRATION.md](CHATGPT-INTEGRATION.md).

The companion runs on the personal agent machine and polls the private ForkBasket HTTPS origin. It needs no inbound port. OAuth tokens stay in Hermes; the web app stores only a SHA-256 digest of a random, revocable worker token. That token can claim and complete jobs for one household and report liveness. It cannot read general shopping/history/images APIs or mutate the household. Household members share the owner's selected companion and its usage. Proposals still require review; generated images use the app's existing private attachment handling.

## Pairing

Use a dedicated profile with exactly one locally owned Codex OAuth credential labeled `personal`; profiles otherwise can borrow the root account. On Pear the profile is already created and logged in. To set up another machine:

```sh
hermes profile create forkbasket --no-alias
hermes -p forkbasket auth add openai-codex --type oauth --label personal
```

Create a pairing token in ForkBasket Settings, then run from the checkout on the agent machine:

```sh
nix develop --command node scripts/hermes-companion.mjs --profile forkbasket --setup https://forkbasket.fruitiex.org
nix develop --command node scripts/hermes-companion.mjs --profile forkbasket
```

The setup command accepts the token at a masked prompt, writes a mode-0600 profile-local `forkbasket-companion.json`, and exits. Never use a ChatGPT bearer token as the app's API key or pairing token. For secure administrative provisioning, the application binary supports `--pair-companion MODEL REASONING [HOUSEHOLD_ID]`; it requires access to the server data/encryption environment and emits pairing JSON once. It selects the companion and enables chat/images, replacing the saved provider configuration. Pipe its output directly into the worker's `--pair-stdin` setup mode; never print or commit that output. If there is more than one household, specify its ID.

Administrators can run `--check-companion [HOUSEHOLD_ID] [--image]` in the same server environment to verify model discovery and a live chat reply through the actual queue. The optional image check creates an unattached private test image and prints only its app URL and sanitized connection metadata.

Pear's NixOS/Home Manager configuration provides `forkbasket-companion.service`, using the pinned Node runtime and installed Hermes launcher. The service restricts writes to the personal profile and Hermes's managed installation cache/locks, and blocks access to Codex CLI/root Hermes authentication files. The user manager already has linger enabled. The service remains conditional on pairing and requires a checkout at `~/forkbasket`; deploy updated scripts before restarting it. Nothing changes the existing Hermes gateway or this coding session's company login.

```sh
systemctl --user restart forkbasket-companion
systemctl --user status forkbasket-companion
```

## Model settings and operation

Chat requests preserve the exact configured model and map reasoning to native Responses `reasoning.effort`. Strict JSON schemas are forwarded, and the server validates every proposal. Model discovery uses the personal account's native catalog. Images invoke Hermes's native image provider directly; supported local tiers are `gpt-image-2-low`, `gpt-image-2-medium` and `gpt-image-2-high`. Native image sizes/quality are advisory and can differ from the selected preset.

The worker refreshes only the explicitly owned personal credential when it nears expiry. Invalid/missing/ambiguous local credentials fail; it never switches to root/company accounts or paid API providers. Pairing can be rotated or revoked in Settings. Removing the provider also revokes worker access.

Jobs are stored in SQLite, bounded to four per household, expire after six minutes and are claimed once with a random completion lease. A failed/crashed worker never causes automatic regeneration, which would spend usage twice. Only completion delivery retries after transient network errors. Prompt context is erased on claim, results are removed after consumption, and expired jobs are purged on startup/claim. Existing NFS rollback journaling remains unchanged. A separate heartbeat keeps long jobs online; offline companions fail promptly. Backups/restoration cancel pending jobs.

The worker logs only task kind, success, duration, exception class and optional HTTP status. It never logs prompts, responses, credentials or provider error bodies. Generated image files may also remain in the profile's private Hermes image cache.

## Verification

```sh
nix develop --command python3 scripts/hermes-companion.check.py
nix develop --command cargo test --manifest-path backend/Cargo.toml
nix develop --command npm run build
FORKBASKET_HERMES_LIVE=1 nix develop --command node scripts/verify-hermes-live.mjs
```

The live test is explicitly opt-in: it consumes personal subscription usage, creates a disposable synthetic household and tests model/reasoning, a reviewed structured proposal, private image persistence and mobile/desktop settings. It restores any pre-existing companion pairing afterward and never modifies the real household. `FORKBASKET_HERMES_UI_ONLY=1` skips provider calls when only the visual checks need repetition. CI runs offline protocol, backend authorization/queue and existing production UI checks without subscription credentials.
