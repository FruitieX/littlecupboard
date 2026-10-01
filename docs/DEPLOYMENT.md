# Deploy ForkBasket

ForkBasket runs as one unprivileged Rust process serving the API and compiled TanStack frontend. SQLite, private photos and encrypted provider configuration live in `/data`. The manifests in `deploy/kubernetes/` follow the existing `/home/rasse/homelab` Flux/SOPS layout, private Envoy HTTPS gateway and `syno-storage` block storage.

The homelab deployment is live as of 2026-10-01 at **https://forkbasket.fruitiex.org**, using the private gateway (`192.168.11.99`). The public gateway returns 404 for this app. Flux reports Ready, the data PVC is bound, and HTTPS/mobile first-owner setup have been verified. The live manifests, encrypted secrets and first-login instructions are in `~/homelab/apps/forkbasket/`; that deployment uses the existing GHCR pull secret and a pinned image digest. The templates here remain reusable deployment examples. Create your owner account, invite your wife and configure the AI provider through Settings when ready.

## Build and image publishing

```sh
nix build .#container
# Load the reproducible OCI/Docker archive locally:
docker load < result
```

The locked flake pins Node, Rust, build dependencies and the container base closure; npm and Cargo lockfiles pin app dependencies. The image runs as UID/GID 10001, listens on 8080, and contains trusted CA certificates. No Node server or external CDN is needed at runtime. `nix build .#backend` and `nix build .#frontend` also produce separate packages.

The GitHub workflow checks the app and publishes `ghcr.io/fruitiex/forkbasket:main` and a commit SHA tag on pushes to main. Use a published digest in your homelab Deployment, following your other apps. A private GHCR package requires a registry pull secret; add `imagePullSecrets` to the pod spec using your existing GHCR secret, or create one with a token having `read:packages`. Package visibility can be set separately in GitHub.

## Flux deployment

1. Copy `deploy/kubernetes/apps/forkbasket/` to `~/homelab/apps/forkbasket/` and `deploy/kubernetes/clusters/homelab/apps/forkbasket.yaml` to `~/homelab/clusters/homelab/apps/`. Add the latter to that directory’s resource list.
2. Confirm the hostname `forkbasket.fruitiex.org`, private gateway, DNS, certificate and storage class. `FORKBASKET_ORIGIN` must exactly match the externally visited scheme and hostname, including a port if applicable. The current manifests use your private Envoy gateway and disable the HTTP request deadline for SSE.
3. Copy `secret.sops.yaml.example` to `secret.sops.yaml`. Generate a random setup token and a **64-character hexadecimal** encryption key. For example, `openssl rand -hex 32` produces either value. Insert them locally; never commit the plaintext file. Encrypt with your homelab’s SOPS configuration/recipients before adding it to Git. The supplied file is a template, not a real secret.
4. Pin the image digest and set image pull credentials if needed. Run `kustomize build apps/forkbasket` after materializing the encrypted secret, review the result locally without publishing decrypted output, then commit/push in your homelab repository when ready to deploy.

Keep one replica with Recreate. SQLite WAL needs local or block storage with reliable POSIX locking; use your `syno-storage` iSCSI/ext4 class. The supplied PVC requests 5 GiB. Do not substitute an NFS volume for SQLite. `fsGroup` makes the volume writable for the non-root process. The Deployment supplies startup, readiness and liveness probes, a read-only root filesystem and a writable temporary volume.

The app supports one initial owner household per installation. The API scopes every account, image, event and AI request to its household. The owner invites other family accounts in Settings; invitations are email-specific, single-use, and expire after seven days. They are links to share yourself; the app does not require SMTP.

## First launch

Open the HTTPS site. Use `FORKBASKET_SETUP_TOKEN` from your deployment secret to create your owner account. Optionally include five editable sample recipes; the shopping list and purchase history start empty. Save your individual recovery code, then invite your wife from Settings. Each member has their own sign-in and recovery code. Password changes sign out other sessions; recovery rotates the code and signs out every previous session. Owner settings can remove a member.

If you omit the setup token and encryption key environment variables, the app creates private `setup-token` and `secret-key` files in its data directory. Preserve the encryption key: changing or losing it makes saved AI credentials unreadable. In Kubernetes, keep the SOPS secret as part of your backup plan.

## Local production run

```sh
nix develop --command npm ci
nix develop --command npm run build
FORKBASKET_STATIC_DIR="$PWD/dist/client" \
FORKBASKET_ORIGIN=http://localhost:8080 \
FORKBASKET_BIND=127.0.0.1:8080 \
nix develop --command cargo run --manifest-path backend/Cargo.toml
```

Or run the image with a persistent named volume:

```sh
docker run --rm --name forkbasket -p 127.0.0.1:8080:8080 \
  -e FORKBASKET_ORIGIN=http://localhost:8080 \
  -v forkbasket-data:/data ghcr.io/fruitiex/forkbasket:main
```

Access the generated setup token using a private terminal (`docker exec forkbasket cat /data/setup-token`). A bind-mounted directory needs UID/GID 10001 write access. For a production reverse proxy, set the origin to your HTTPS hostname, stream `/api/events` without buffering, allow 8 MB photo uploads and up to 96 MB restore requests, and allow at least 120 seconds for provider calls. HTTPS enables secure cookies and installable offline use. `/api/health` is liveness; `/api/ready` checks the database. Logs report service errors and startup, without logging passwords/provider credentials.

## Mobile and offline use

Visit once online, then install from your browser’s app menu or Add to Home Screen. The service worker keeps a versioned app shell and bundled assets; API responses and private photos are not cached by it. Household state and pending shopping operations are persisted on that signed-in device. Checking, restoring, adding and editing can be queued offline; reloading offline works after the shell finishes installing. A browser that supports Web Locks also recovers unsynced work from closed tabs.

The connection indicator shows offline/pending changes. Reconnect to sync. Concurrent quantity or description edits may need review; the app keeps the operation and shows the server’s latest state. Discard the stale operation and reapply the intended edit. A check cannot silently credit extra ingredients that another device added while you were offline. Keep the device’s site data until outstanding work has synced. Signing out requires syncing or discarding pending operations and clears that account’s local state. Photos and provider requests need connectivity.

## AI configuration

In Settings, configure a compatible base URL (usually ending in `/v1`), chat model and optional API key. Local HTTP endpoints are supported. Test the connection, save, then enable the household assistant. Keys are encrypted with ChaCha20-Poly1305 on the server and never returned to the browser. The assistant appears only when enabled. It receives current recipes, products, preferences, shopping/pantry/plan data, a recent meal summary and learned shopping signals; no account credentials or provider secrets are included in the prompt.

Choose strict JSON Schema for providers that support it, JSON mode for compatible servers, or prompted JSON as a fallback. All modes receive the same server validation. Configure `max_completion_tokens`, legacy `max_tokens`, or omission depending on your endpoint. An image model is optional and uses the same provider’s `/images/generations` endpoint. Base64 images work; remote image URLs must use the provider’s origin or OpenAI image storage. Generated and uploaded photos are decoded, metadata stripped and resized before private storage.

Proposals remain drafts until selected and saved. If the household changes during review, request a fresh proposal before applying it. Provider fixtures test chat, malformed proposals, secret encryption and image generation. Live provider compatibility needs your later endpoint/model configuration. The implementation follows [Chat Completions structured-output documentation](https://developers.openai.com/api/docs/guides/structured-outputs) and the [image-generation API](https://developers.openai.com/api/docs/guides/image-generation), with compatibility controls for other providers.

## Backups and upgrades

Settings offers an owner-only household JSON backup containing recipes, list, pantry, history and private photos. Accounts and provider secrets are excluded. Restore replaces household content atomically, checks the current revision, validates data, and remaps private image IDs. Sync all family devices first and download the current backup before restoring. Browser restoration accepts backups up to 90 MB, with at most 64 MB of decoded images. Use full database restoration for larger backups.

For a complete, consistent backup while the service is running, use the SQLite online backup command:

```sh
kubectl exec deploy/forkbasket -- forkbasket-api --backup /data/backup-2026-09-30.sqlite3
kubectl cp default/$(kubectl get pod -l app=forkbasket -o jsonpath='{.items[0].metadata.name}'):/data/backup-2026-09-30.sqlite3 ./forkbasket-backup.sqlite3
```

The image includes `tar` for `kubectl cp`. You can also use your storage backup tooling. The `--backup` command refuses to overwrite a destination and produces a private file. Back up the database **and** SOPS encryption key/configuration. Image bytes and accounts are inside SQLite. Do not copy just the live SQLite main file while WAL writes are active; use the online backup or a consistent stopped-volume snapshot.

To restore the complete installation, stop/scale down the Deployment, restore `forkbasket.sqlite3` from a consistent backup, remove obsolete WAL/SHM files while stopped, preserve owner permissions and the matching encryption key, then restart. Never replace the live database beneath the server. Check `/api/ready`, sign in, inspect recipes/photos and test shared shopping. Keep backup copies outside the PVC and periodically verify restoration.

Before upgrading, take a full backup, pin the new image digest and let Flux replace the single pod. Schema migrations run transactionally at startup; newer unknown schema versions are rejected. To downgrade across a schema change, restore a backup from the matching older version. Service-worker updates activate after existing app windows close, so finish syncing and reopen the app after an upgrade.
