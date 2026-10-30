# Deploy LittleCupboard

LittleCupboard runs as one unprivileged Rust process serving the API and compiled TanStack frontend. SQLite, private photos and encrypted provider configuration live in `/data`. The manifests in `deploy/kubernetes/` follow the Flux/SOPS layout of the [homelab](https://github.com/FruitieX/homelab) repository, which holds the live deployment, and attach to public and private Gateway API HTTPS listeners. The reusable templates default to block storage; NFS works with rollback journaling as described below.

## Browser updates and caching

JavaScript/CSS assets have content-hashed URLs and immutable one-year caching. HTML, the manifest and unversioned artwork revalidate on normal requests; the server ignores modification-date validators for these because reproducible Nix builds keep identical file mtimes across releases. `/sw.js` has `no-store` and is registered with `updateViaCache: 'none'`. Private API data and attachments are not placed in the service-worker caches.

The app checks for updates when opened, brought to the foreground, reconnected and every five minutes while visible and online. A small **New version available → Reload app** notice activates the complete cached release and reloads that tab. Unsaved form edits require confirmation; queued shopping operations remain on the device and resume synchronization. Other tabs keep their drafts and display their own update notice. The preceding release's asset cache is retained for old open tabs; older caches are removed. Offline navigation uses the latest activated shell. Older installed versions need one refresh to pick up this update UI, after which hard reloads should no longer be needed.

The live manifests and encrypted secrets are in the homelab repository (`apps/littlecupboard/`), pinned to an image digest. The templates here remain reusable deployment examples. On a new installation, create your owner account, invite other family members and configure the AI provider through Settings when ready. Public ingress does not expose NFS, the companion's inbound ports or OAuth credentials.

## Build and image publishing

```sh
nix build .#container
# Load the reproducible OCI/Docker archive locally:
docker load < result
```

The locked flake pins Node, Rust, build dependencies and the container base closure; npm and Cargo lockfiles pin app dependencies. The image runs as UID/GID 10001, listens on 8080, and contains trusted CA certificates. No Node server or external CDN is needed at runtime. `nix build .#backend` and `nix build .#frontend` also produce separate packages.

The GitHub workflow checks the app and publishes `ghcr.io/fruitiex/littlecupboard:main` and a commit SHA tag on pushes to main. After successful validation and publication, it dispatches the immutable image digest and source revision to `FruitieX/homelab`. The receiver updates only `apps/littlecupboard/deployment.yaml`, commits the new SHA tag and digest, and Flux rolls out the image. Pull requests and release tags do not deploy; an older main build is skipped if a newer main commit exists. A private GHCR package requires a registry pull secret.

Enable this path by adding **`HOMELAB_DISPATCH_TOKEN`** to [LittleCupboard's GitHub Actions secrets](https://github.com/FruitieX/littlecupboard/settings/secrets/actions). Use a fine-grained GitHub PAT restricted to **FruitieX/homelab** with **Contents: Read and write**. The sender uses this credential only to send the dispatch; the receiver commits with homelab's built-in `GITHUB_TOKEN`. Without the secret, CI still validates and publishes, and explicitly warns that automatic deployment is disabled. Once configured, run the workflow on the latest main commit or push a new commit. Inspect both repositories' Actions runs and Flux readiness to confirm the complete path.

If the token is in a password manager, transfer it directly through GitHub's secret form, or pipe it into the CLI in an authenticated local terminal. Substitute your own vault, item and field in this example; do not paste the value into chat or a committed file:

```sh
set -o pipefail
op read 'op://<vault>/<item>/credential' |
  gh secret set HOMELAB_DISPATCH_TOKEN --repo FruitieX/littlecupboard
```

For ongoing agent access, use a dedicated vault containing only agent-accessible credentials and a [1Password service account](https://www.1password.dev/service-accounts/get-started) granted only `read_items` in that vault. Disable vault creation and omit write/share permissions. Authenticate the CLI with `OP_SERVICE_ACCOUNT_TOKEN` injected by the agent launcher. A scoped service account is the access boundary; a CLI vault selector alone does not restrict a personal account. Run agents in a separate OS user or container if they must also be isolated from your personal session's credentials and 1Password integration. Keep the plaintext service-account credential outside the repository; SOPS ciphertext can be versioned.

## Flux deployment

1. Copy `deploy/kubernetes/apps/littlecupboard/` to `apps/littlecupboard/` and `deploy/kubernetes/clusters/homelab/apps/littlecupboard.yaml` to `clusters/homelab/apps/` in your Flux repository. Add the latter to that directory’s resource list.
2. Set your hostname and confirm the public/private gateways, DNS, router port forwarding, certificate and storage class. `LITTLECUPBOARD_ORIGIN` must exactly match the externally visited scheme and hostname, including a port if applicable. The current manifests attach to both HTTPS gateways, rely on a public wildcard DNS record and disable the HTTP request deadline for SSE. For a private-only deployment, remove the public parent and the external-dns exclusion so the controller manages its private DNS record instead. Adapt DNS if you do not have a wildcard/port-forwarding setup.
3. Copy `secret.sops.yaml.example` to `secret.sops.yaml`. Generate a random setup token and a **64-character hexadecimal** encryption key. For example, `openssl rand -hex 32` produces either value. Insert them locally; never commit the plaintext file. Encrypt with your homelab’s SOPS configuration/recipients before adding it to Git. The supplied file is a template, not a real secret.
4. Pin the image digest and set image pull credentials if needed. Run `kustomize build apps/littlecupboard` after materializing the encrypted secret, review the result locally without publishing decrypted output, then commit/push in your homelab repository when ready to deploy.

Keep one replica with Recreate. SQLite defaults to WAL for local or block storage; the reusable PVC example requests 5 GiB of block storage (the `storageClassName` is an example; use your own). For NFS, explicitly set `LITTLECUPBOARD_SQLITE_JOURNAL_MODE=DELETE`: [WAL cannot operate over a network filesystem](https://sqlite.org/wal.html). DELETE uses rollback journaling with `synchronous=EXTRA`, including a directory sync after a commit. Use NFSv4 with working POSIX locks and durable server writes; never mount with `nolock` or run multiple app replicas against the database. This depends on the NAS correctly implementing locking and sync operations. `fsGroup` makes the volume writable for the non-root process. The Deployment supplies startup, readiness and liveness probes, a read-only root filesystem and a writable temporary volume.

The app supports one initial owner household per installation. The API scopes every account, image, event and AI request to its household. The owner invites other family accounts in Settings; invitations are email-specific, single-use, and expire after seven days. They are links to share yourself; the app does not require SMTP.

## First launch

Open the HTTPS site. Use `LITTLECUPBOARD_SETUP_TOKEN` from your deployment secret to create your owner account. Optionally include five editable sample recipes; the shopping list and purchase history start empty. Save your individual recovery code, then invite the rest of the household from Settings. Each member has their own sign-in and recovery code. Password changes sign out other sessions; recovery rotates the code and signs out every previous session. Owner settings can remove a member.

If you omit the setup token and encryption key environment variables, the app creates private `setup-token` and `secret-key` files in its data directory. Preserve the encryption key: changing or losing it makes saved AI credentials unreadable. In Kubernetes, keep the SOPS secret as part of your backup plan.

## Passkey sign-in (OIDC, optional)

LittleCupboard can sign people in through an OpenID Connect provider such as Pocket ID. Without these variables it behaves exactly as before. With them, the sign-in screen leads with “Sign in with passkey” and keeps email/password sign-in as a quieter fallback; a device that signs in with a password goes straight to the password form next time.

| Variable                             | Meaning                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `LITTLECUPBOARD_OIDC_ISSUER`         | Provider issuer URL, e.g. `https://id.example.com`.                                                                            |
| `LITTLECUPBOARD_OIDC_CLIENT_ID`      | Client id registered at the provider.                                                                                          |
| `LITTLECUPBOARD_OIDC_CLIENT_SECRET`  | Client secret (keep it in the SOPS secret).                                                                                    |
| `LITTLECUPBOARD_OIDC_REDIRECT_URL`   | Optional; defaults to `$LITTLECUPBOARD_ORIGIN/api/auth/oidc/callback`. Register this callback at the provider.                 |
| `LITTLECUPBOARD_OIDC_ALLOWED_GROUPS` | Optional comma-separated groups; sign-in requires one of them.                                                                 |
| `LITTLECUPBOARD_OIDC_USER_MAP`       | Optional `provideruser:local@email,...` links existing password accounts to provider usernames on their first passkey sign-in. |

OIDC is enabled only when the issuer, client id and client secret are all set. Identities are keyed by issuer and subject. On a first sign-in the app uses an existing link, then the user map; anyone else in an allowed group becomes a password-less member of the household (only when exactly one household exists). An account already linked to one provider identity is never linked to a second, so a recreated provider user cannot take it over. Passkey sessions last 365 days and slide while the app is in use; password sessions keep their 30-day lifetime. Signing in from the legacy hostname first moves to `LITTLECUPBOARD_ORIGIN`. Owner settings can remove such members, or run `kubectl exec deploy/littlecupboard -- littlecupboard-api --remove-member EMAIL`. A photo or typed item the AI could not add stays in the shopping list with Retry and Dismiss; failed photo jobs are kept until one is chosen. To requeue one for the running server, run `kubectl exec deploy/littlecupboard -- littlecupboard-api --retry-photo-job JOB_ID`, or add a typed name to queue a copy without its photos. `npm run test:oidc` runs the flow against a mock provider in the production build.

## Local production run

```sh
nix develop --command npm ci
nix develop --command npm run build
LITTLECUPBOARD_STATIC_DIR="$PWD/dist/client" \
LITTLECUPBOARD_ORIGIN=http://localhost:8080 \
LITTLECUPBOARD_BIND=127.0.0.1:8080 \
nix develop --command cargo run --manifest-path backend/Cargo.toml
```

Or run the image with a persistent named volume:

```sh
docker run --rm --name littlecupboard -p 127.0.0.1:8080:8080 \
  -e LITTLECUPBOARD_ORIGIN=http://localhost:8080 \
  -v littlecupboard-data:/data ghcr.io/fruitiex/littlecupboard:main
```

Access the generated setup token using a private terminal (`docker exec littlecupboard cat /data/setup-token`). A bind-mounted directory needs UID/GID 10001 write access. For a production reverse proxy, set the origin to your HTTPS hostname, stream `/api/events` without buffering, allow 8 MB photo uploads and up to 96 MB restore requests, and allow at least 120 seconds for provider calls. HTTPS enables secure cookies and installable offline use. `/api/health` is liveness; `/api/ready` checks the database. Logs report service errors and startup, without logging passwords/provider credentials.

## Mobile and offline use

Visit once online, then install from your browser’s app menu or Add to Home Screen. The service worker keeps a versioned app shell and bundled assets; API responses and private photos are not cached by it. Household state and pending shopping operations are persisted on that signed-in device. Checking, restoring, adding and editing can be queued offline; reloading offline works after the shell finishes installing. A browser that supports Web Locks also recovers unsynced work from closed tabs.

Shopping defaults to a continuous tile grid sorted by the selected store’s aisle order. Settings → Shopping list → Group by category restores category headings and separate grids. This is an account-specific preference on that device, like the current store selection.

The connection indicator shows offline/pending changes. Reconnect to sync. Concurrent quantity or description edits may need review; the app keeps the operation and shows the server’s latest state. Discard the stale operation and reapply the intended edit. A check cannot silently credit extra ingredients that another device added while you were offline. Keep the device’s site data until outstanding work has synced. Signing out requires syncing or discarding pending operations and clears that account’s local state. Photos and provider requests need connectivity.

## Catalog and pantry settings

Settings links to dedicated pages for stores/aisle order, item groups, items and recipes. All support direct links and browser navigation. Family/kitchen preferences, account/backup tools and collapsed owner-only assistant configuration remain on the main page.

Shops may contain any subset of the household's item groups. In Stores or Edit shop, add/remove aisles and move them along your route. Items from omitted groups stay visible after the configured aisles. New household groups become available to add rather than changing every shop's route. Edit shop also supports a private store-map upload and a reviewable AI route suggestion using the saved chat model/reasoning and API or personal companion transport. Use this order fills the editor; Save shop persists it. Maps are temporary inputs, not saved shop attachments, and unused-photo cleanup can reclaim them.

Schema 8 protects partial shop routes from older binaries that required all groups in every shop; schema 9 guards the optional recipe planning flag against older strict deserializers. Before reverting to a schema-7 binary, restore a consistent schema-7 SQLite backup with the matching encryption key. The fresh pre-upgrade homelab backup is `/data/before-family-refinements-20261002.sqlite3`; the earlier `/data/before-store-layout-icons-20261002.sqlite3` is also retained. Catalog artwork is bundled, not stored as duplicate uploads on NFS; private household pictures retain priority. See [artwork provenance and regeneration](artwork/README.md).

Settings → Items → edit an item can set a household consumption rate as a quantity and unit over a number of days. A saved rate overrides the learned estimate and guides restock timing when the usual purchased package uses compatible units. With no setting, at least three shopping days with compatible quantities establish a labeled estimate; **Use estimated rate** adopts it only after saving. Same-day purchases are combined, known mass/volume units are normalized, robust median rates reduce outlier effects, long gaps are ignored and unrelated package units are not converted. Restores and guarded history undo correct buying evidence. Estimated consumption is a guide, not an automatic deduction from confirmed pantry stock. The assistant receives configured rates and learned estimates.

Each pantry entry has an edit action for total quantities, multiple units, notes and use-by date. Include amounts reserved for upcoming meals in the total; saving confirms stock, preserves available reservations and releases credits when there is a shortage. Cancel preserves the record. Consecutive offline edits retain their concurrency guards without treating device/server timestamp differences as changed quantities. Consumption settings and pantry edits are household data included in JSON and full SQLite backups.

## AI configuration

Settings also supports an opt-in [personal Hermes companion](HERMES-COMPANION.md) with independent chat model/reasoning controls, recipe-image transcription and native image generation. The worker polls the same HTTPS origin; it needs no inbound port. OAuth stays on its dedicated personal profile, and the app stores only a hashed, revocable worker token. Companion requests can take up to six minutes; allow that request duration and up to 28 MB on `/api/companion/complete` for generated-image delivery. Image-bearing job claims can be up to 9 MB. The homelab HTTPRoute disables request timeouts on both gateways. Current SQLite schema version is 10: durable image-generation jobs follow schema 9’s recipe planning eligibility, schema 8’s optional shop aisle routes, schema 7’s source image archives, schema 6's household consumption rates, schema 5's durable item-icon jobs, schema 4's catalog customization/archive fields and schema 3's shop images and configurable prompts. Take a full database backup before upgrading and restore it before reverting to an older binary. Restart the personal worker after updating its scripts; the old worker does not support image-bearing chat input.

The owner can enable **Automatically generate icons for new items** inside Compatibility & image generation, then save the provider. This applies to newly saved catalog products, including shopping, recipe ingredients and accepted assistant proposals. It does not backfill existing products; use **Generate missing icons**, review the count/quota confirmation, then start the batch. The generic cart or empty icon with no attached image is considered missing; distinctive emoji artwork, uploaded/generated images and archived products are preserved. The server groups up to 16 queued items from the same household into one square icon-sheet request (4×4 for 16 items), using a persisted limit of 20 background provider requests per household per rolling hour. A single item uses the individual generator; remaining jobs wait for the next allowance. Each cell becomes its own transparent 256px WebP. Sheets without transparency or with empty/overlapping cells fail for explicit retry rather than attaching broken tiles. Progress survives closing the app and a server restart. An interrupted request may be generated again after restart because the provider cannot guarantee idempotent image requests. Failures wait for explicit retry. Stop generation prevents queued/in-flight results from being attached, although an already-started provider request may still consume quota. Turning automatic icons off cancels its pending/in-flight attachments while leaving an explicitly started bulk batch alone. Completed icons are private household images with real transparency where supported, resized to 256 px using the existing item prompt/reference style. Concurrent artwork, renamed/deleted/archived items and canceled jobs are rechecked before an atomic image/state/history commit; unsuitable results are discarded. No new companion credential or worker configuration is required.

In Settings, configure a compatible base URL (usually ending in `/v1`), chat model and optional API key. Local HTTP endpoints are supported. Test the connection, save, then enable the household assistant. Keys are encrypted with ChaCha20-Poly1305 on the server and never returned to the browser. The assistant appears only when enabled. It receives current recipes, products, preferences, shopping/pantry/plan data, a recent meal summary and learned shopping signals; no account credentials or provider secrets are included in the prompt.

Advanced prompts opens with the effective saved instructions, using the backend defaults for any missing, null or blank prompt field in older configurations. Custom nonblank instructions are preserved exactly. These defaults also apply to generation and background icon jobs without requiring a provider resave or credential repair. The settings form waits for configuration to load; failures expose Retry rather than empty editable fields, and reconnect retries an unsuccessful load. Restore default prompts updates the form and requires Save provider to apply. Default item/shop instructions request flat Twemoji-style transparent icons; the companion additionally receives the bundled style reference, including when the default text differs only in surrounding whitespace. Recipe photo instructions remain separate.

The current provider integration uses Chat Completions and Images APIs with API credentials. A Codex/ChatGPT subscription cannot be connected by pasting its login token into these fields. OpenAI's [Sign in with ChatGPT](https://developers.openai.com/siwc/quickstart) supports eligible plan usage through OAuth and the [Responses API](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), but that sign-in/transport is not implemented in LittleCupboard. The documented [plan-usage preview does not support image generation](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations). Native Codex image generation is a separate capability: a local ChatGPT-authenticated probe successfully generated an image. [The investigation](CHATGPT-INTEGRATION.md) records the tested protocol, hosted-service authentication boundaries and proposed personal companion. A regular OpenAI API key uses separately billed API access, including image generation.

Choose strict JSON Schema for providers that support it, JSON mode for compatible servers, or prompted JSON as a fallback. All modes receive the same server validation. Configure `max_completion_tokens`, legacy `max_tokens`, or omission depending on your endpoint. An image model is optional and uses the same provider’s `/images/generations` endpoint. Base64 images work; remote image URLs must use the provider’s origin or OpenAI image storage. Generated and uploaded photos are decoded, metadata stripped and resized before private storage.

Recipe editors and assistant proposals offer **Generate missing ingredient icons** / **Generate missing icons** when multiple items lack artwork. Missing items are processed in sheets of up to 16 with the saved item prompt and default companion style reference. Review each preview before saving; models may still swap subjects. Existing icons are kept and individual regeneration/upload remains available. Generated drafts do not modify the household until saved. All crops are stored privately; the raw sheet is discarded, and storage/proposal validation is atomic.

Single icons, store pictures, dish photos and draft icon sheets are generated through durable server-side jobs (`/api/ai/jobs`). The dialog returns immediately and shows queueing/generation progress; a dropped connection, a phone that sleeps, a closed dialog or a page reload never fails the request, and reopening the same editor or assistant collects the running or finished image to review and save. Retrying a request whose response was lost collects the original job instead of spending provider quota twice, and an identical in-flight request is adopted rather than duplicated. While the personal companion is offline, queued work waits briefly before expiring with an explicit message. The older synchronous image endpoints remain available so a still-cached frontend keeps working during rollout.

The recipe composer and existing ingredient rows use the same icon-bearing autocomplete. Typing an unknown name offers **Add new ingredient**; leaving that name filled and saving also creates it. Edit an ingredient name to replace the recipe’s reference without renaming the shared catalog item. Amounts, units and details remain; duplicates with the same unit combine, while differing units require correction before saving.

Use tags to create recipe collections such as Desserts or Snacks. **Include in meal planning** defaults to enabled for existing recipes. Turn it off in the editor to keep a recipe in the library while excluding it from weekly choices, lunch suggestions and AI schedules. Existing deliberate schedules remain untouched. A partner can edit this shared flag, and backups preserve it. AI recipe drafts include an eligibility flag and collection tags; the server rejects any proposed schedule using an excluded recipe.

Proposals remain drafts until selected and saved. The dialog closes only after the server acknowledges the selected changes; queued/offline and failed saves stay available for review. If the household changes during review, request a fresh proposal before applying it. Provider fixtures test chat, malformed proposals, secret encryption and image generation. Live provider compatibility needs your later endpoint/model configuration. The implementation follows [Chat Completions structured-output documentation](https://developers.openai.com/api/docs/guides/structured-outputs) and the [image-generation API](https://developers.openai.com/api/docs/guides/image-generation), with compatibility controls for other providers.

New image-assisted recipe drafts retain every supplied source image and its filename. Sources are preserved at their original oriented resolution, with metadata removed; screenshots use lossless WebP and JPEG photos are re-encoded at quality 95. This preserves source material rather than the exact original file bytes. The existing decoded-image bounds, 8 MB per-source limit and 64 MB household storage limit apply. AI requests receive separate resized vision previews, so archival resolution does not enlarge companion job claims. Source images are linked independently of generated dish photos; recipe details open them at full resolution, and editing can remove a link before saving. Household ownership and private image authorization apply to every source, and cleanup retains sources used by recipes, active proposals or undo history. Household JSON backups preserve the source marker/resolution and remap source links during restore. Earlier imported recipes without stored source associations are not guessed or backfilled.

Recipe tag filters derive from both legacy primary tags and every saved tag. The editor suggests household tags, supports creating new ones, trims duplicate/case variants and preserves the existing spelling. Filters update across devices with recipe sync. On mobile, the chip row scrolls horizontally without widening the page.

## Backups and upgrades

Settings offers an owner-only household JSON backup containing recipes, list, pantry, history and private photos. Accounts and provider secrets are excluded. Restore replaces household content atomically, checks the current revision, validates data, and remaps private image IDs. Sync all family devices first and download the current backup before restoring. Browser restoration accepts backups up to 90 MB, with at most 64 MB of decoded images. Use full database restoration for larger backups.

For a complete, consistent backup while the service is running, use the SQLite online backup command:

```sh
kubectl exec deploy/littlecupboard -- littlecupboard-api --backup /data/backup-2026-09-30.sqlite3
kubectl cp default/$(kubectl get pod -l app=littlecupboard -o jsonpath='{.items[0].metadata.name}'):/data/backup-2026-09-30.sqlite3 ./littlecupboard-backup.sqlite3
```

The image includes `tar` for `kubectl cp`. You can also use your storage backup tooling. The `--backup` command refuses to overwrite a destination and produces a private file. Back up the database **and** SOPS encryption key/configuration. Image bytes and accounts are inside SQLite. Do not copy just the live SQLite main file while WAL writes are active; use the online backup or a consistent stopped-volume snapshot.

To restore the complete installation, stop/scale down the Deployment, restore `forkbasket.sqlite3` from a consistent backup, remove obsolete WAL/SHM files while stopped, preserve owner permissions and the matching encryption key, then restart. Never replace the live database beneath the server. Check `/api/ready`, sign in, inspect recipes/photos and test shared shopping. Keep backup copies outside the PVC and periodically verify restoration.

Before upgrading, take a full backup, pin the new image digest and let Flux replace the single pod. Schema migrations run transactionally at startup; newer unknown schema versions are rejected. To downgrade across a schema change, restore a backup from the matching older version. A waiting service-worker update offers **Reload app**; use it to activate the update. Unsaved form edits require confirmation, and pending shopping changes remain on the device for later synchronization. Closing all app windows also allows activation.

## Rebranding compatibility

LittleCupboard replaces ForkBasket. New source/package/container/repository names use `littlecupboard`. The canonical origin is set by `LITTLECUPBOARD_ORIGIN`; an old hostname can remain routed to the same installation with `LITTLECUPBOARD_LEGACY_ORIGINS=https://<old host>` to let existing devices sync pending changes. The old site offers a link only after the queue is empty and connected. Sign in at the new address with the same account; browser storage and installed PWAs belong to their origin, so reinstall the app from the new address. No automatic cross-origin transfer of credentials or offline edits occurs.

The database filename `forkbasket.sqlite3` is deliberately retained. The `forkbasket_session` cookie and original browser storage/Web Lock namespace remain compatible. New backups identify themselves as `littlecupboard-household-v1`; restore also accepts `forkbasket-household-v1`. `LITTLECUPBOARD_*` environment variables take priority, with corresponding `FORKBASKET_*` variables accepted for existing encrypted secrets. Both same-origin protection headers are supported; only the canonical origin and explicitly configured legacy origins may write. Built-in saved prompts receive the new name on read; custom instructions are preserved. No schema upgrade or AI credential rotation is needed.
