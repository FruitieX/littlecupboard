# Personal Hermes companion

LittleCupboard can use a personal Hermes profile for ChatGPT/Codex chat and native image generation. In Settings choose **Personal Hermes companion**. Chat model and reasoning effort are independent settings; the requested initial configuration is `gpt-6-luna` / `xhigh`, with `gpt-image-2-medium` for images. This is an opt-in personal integration using Hermes's native backend, not SIWC or an OpenAI API key. The native route's hosted-service support boundary is documented in [CHATGPT-INTEGRATION.md](CHATGPT-INTEGRATION.md).

The companion runs on the personal agent machine and polls the private LittleCupboard HTTPS origin. It needs no inbound port. OAuth tokens stay in Hermes; the web app stores only a SHA-256 digest of a random, revocable worker token. That token can claim and complete jobs for one household and report liveness. It cannot read general shopping/history/images APIs or mutate the household. Household members share the owner's selected companion and its usage. Proposals still require review; generated images use the app's existing private attachment handling.

## Pairing

Use a dedicated profile with exactly one locally owned Codex OAuth credential labeled `personal`; profiles otherwise can borrow the root account. On Honeydew the existing `forkbasket` profile is already created and logged in. Keep that profile name to preserve its isolated personal credential. To set up another machine:

```sh
hermes profile create littlecupboard --no-alias
hermes -p littlecupboard auth add openai-codex --type oauth --label personal
```

Create a pairing token in LittleCupboard Settings, then run from the checkout on the agent machine:

```sh
nix develop --command node scripts/hermes-companion.mjs --profile littlecupboard --setup https://littlecupboard.fruitiex.org
nix develop --command node scripts/hermes-companion.mjs --profile littlecupboard
```

The setup command accepts the token at a masked prompt, writes a mode-0600 profile-local `littlecupboard-companion.json`, and exits. Never use a ChatGPT bearer token as the app's API key or pairing token. For secure administrative provisioning, the application binary supports `--pair-companion MODEL REASONING [HOUSEHOLD_ID]`; it requires access to the server data/encryption environment and emits pairing JSON once. It selects the companion and enables chat/images, replacing the saved provider configuration. Pipe its output directly into the worker's `--pair-stdin` setup mode; never print or commit that output. If there is more than one household, specify its ID.

Administrators can run `--check-companion [HOUSEHOLD_ID] [--image]` in the same server environment to verify model discovery and a live chat reply through the actual queue. The optional image check creates an unattached private test image and prints only its app URL and sanitized connection metadata.

Honeydew's NixOS/Home Manager configuration provides `littlecupboard-companion.service`, using the pinned Node runtime and installed Hermes launcher. The service restricts writes to the personal profile and Hermes's managed installation cache/locks, and blocks access to Codex CLI/root Hermes authentication files. The user manager already has linger enabled. The service remains conditional on pairing and requires a checkout at `~/projects/littlecupboard`; deploy updated scripts before restarting it. Nothing changes the existing Hermes gateway or this coding session's company login.

```sh
systemctl --user restart littlecupboard-companion
systemctl --user status littlecupboard-companion
```

## Model settings and operation

Chat requests preserve the exact configured model and map reasoning to native Responses `reasoning.effort`. Strict JSON schemas are forwarded, and the server validates every proposal. Model discovery uses the personal account's native catalog. Images invoke Hermes's native image provider directly; supported local tiers are `gpt-image-2-low`, `gpt-image-2-medium` and `gpt-image-2-high`. Native image sizes/quality are advisory and can differ from the selected preset.

The assistant accepts up to four private household recipe images from upload, camera capture or clipboard paste. LittleCupboard verifies image ownership and sends inline JPEG/PNG/WebP content; the companion maps it to native `input_image` parts. The selected chat model must support vision. Transcriptions become reviewed recipe drafts, with uncertainty called out in the assistant message. **Generate dish photo** uses the draft's actual ingredients and method, stores the result in the server-side proposal, and saves it with the recipe only when the proposal is applied. New proposed products have an optional **Generate icon** control with the same review semantics.

Item and shop generation uses flat Twemoji-style instructions and requests `background: transparent` / PNG. With the default icon prompt, the companion also receives a small sheet of the existing catalog artwork as a style reference. Customized icon prompts omit that reference so owners can change the style deliberately. Generated icons are stored as lossless WebP with a maximum 256-pixel edge; alpha is preserved through resizing, private serving and backup/restore. Recipe photos keep the larger 1600-pixel storage limit. Existing photos are untouched. Camera orientation is applied before upload metadata is discarded.

The [GPT Image 2 API](https://developers.openai.com/api/docs/guides/image-generation) accepts custom sizes with a minimum 655,360 pixels and edges divisible by 16: the smallest square is 816 × 816. LittleCupboard requests this for GPT Image 2 icons, but the native subscription backend may return a larger image. A real personal-only icon test returned 1254 × 1254 with alpha ranging from 0 to 255, including a reference-guided trial; a separate `gpt-6-luna` / `xhigh` vision test preserved every quantity and step in a synthetic recipe screenshot. `LITTLECUPBOARD_HERMES_LIVE=1 nix develop --command node scripts/verify-media-live.mjs` repeats those bounded tests without changing the production pairing file. `LITTLECUPBOARD_MEDIA_ICON_ONLY=1` skips the vision request.

AI setup and **Advanced prompts** are collapsed by default and available only to household owners. Assistant, item/shop icon and recipe photo instructions are editable, with a restore-defaults action. Server-owned response contracts, household scope, validation, and the review step are retained. These text settings contain no provider credentials.

The worker refreshes only the explicitly owned personal credential when it nears expiry. Invalid/missing/ambiguous local credentials fail; it never switches to root/company accounts or paid API providers. Pairing can be rotated or revoked in Settings. Removing the provider also revokes worker access.

Disconnect/removal is inside the collapsed configuration section and requires confirmation, as do replacing a paired token and revoking companion access. If configuration is accidentally deleted, the Hermes ChatGPT login remains intact: pair the household again and install the new scoped token in the existing personal profile. Administrative provisioning with `--pair-companion gpt-6-luna xhigh` can do this without rolling back shopping/recipe data; capture its JSON in memory and pass it to `--pair-stdin`, never to tool logs. Wrappers such as Nix shell hooks may emit additional stdout, so validate the pairing JSON before forwarding it. Restart the worker after updating its pairing file.

Jobs are stored in SQLite, bounded to four per household, expire after six minutes and are claimed once with a random completion lease. A failed/crashed worker never causes automatic regeneration, which would spend usage twice. Only completion delivery retries after transient network errors. Prompt context is erased on claim, results are removed after consumption, and expired jobs are purged on startup/claim. Existing NFS rollback journaling remains unchanged. A separate heartbeat keeps long jobs online; offline companions fail promptly. Backups/restoration cancel pending jobs.

The worker logs only task kind, success, duration, exception class and optional HTTP status. It never logs prompts, responses, credentials or provider error bodies. Generated image files may also remain in the profile's private Hermes image cache.

On 2026-10-01 this setup was paired with the live private homelab application. The running user service passed native model discovery, `gpt-6-luna` / `xhigh` chat and image generation through the actual HTTPS job queue; the generated image's public unauthenticated request returned 401. Personal token refresh was also verified with root Hermes and Codex CLI credentials blocked. The NixOS configuration is committed; user Home Manager activation installs/runs the service immediately, and the administrator must switch Pear's NixOS generation to preserve that new unit through future system boot activation.

## Verification

```sh
nix develop --command python3 scripts/hermes-companion.check.py
nix develop --command cargo test --manifest-path backend/Cargo.toml
nix develop --command npm run build
LITTLECUPBOARD_HERMES_LIVE=1 nix develop --command node scripts/verify-hermes-live.mjs
```

The live test is explicitly opt-in: it consumes personal subscription usage, creates a disposable synthetic household and tests model/reasoning, a reviewed structured proposal, private image persistence and mobile/desktop settings. It restores any pre-existing companion pairing afterward and never modifies the real household. `LITTLECUPBOARD_HERMES_UI_ONLY=1` skips provider calls when only the visual checks need repetition. CI runs offline protocol, backend authorization/queue and existing production UI checks without subscription credentials.

### Existing personal companion after rebranding

The production companion runs on Honeydew. Preserve its dedicated `forkbasket` Hermes profile and existing `forkbasket-companion.json` pairing file; the new worker reads that filename when the new filename is absent. Change only the saved URL to `https://littlecupboard.fruitiex.org`, preserving the token and file permissions. Run the new service from `~/projects/littlecupboard` with `--profile forkbasket`. New installations may use a `littlecupboard` profile. This does not import or touch default/company credentials.

This transition was completed on 2026-10-02. Honeydew's Home Manager generation installs and runs `littlecupboard-companion.service`; the former unit is stopped and removed. The pairing URL now uses the new ingress, with its token and mode-0600 permissions preserved. Production model discovery and `gpt-6-luna` / `xhigh` chat passed through the new URL, and the worker remains active with zero restarts. Both machines retain `~/forkbasket` as a compatibility symlink to `~/projects/littlecupboard`.
