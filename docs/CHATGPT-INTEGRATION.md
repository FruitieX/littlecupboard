# ChatGPT and Codex integration investigation

Investigated on 2026-10-01. This records evidence and an implementation design; ForkBasket does not yet expose a subscription connector. No production credentials or homelab runtime configuration were changed for this investigation.

## What was verified locally

The installed `codex-cli 0.159.3` can run behind a JSON-RPC client over stdio with its existing ChatGPT login. The probe in [scripts/probe-codex.mjs](../scripts/probe-codex.mjs) completed two independent ephemeral threads using synthetic data:

| Trial                        | Result                                                                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structured shopping proposal | Completed in 7 seconds; JSON Schema constrained output proposed four apples, with empty recipe/plan arrays.                                                                                                |
| Native image generation      | Completed in 30 seconds; emitted `imageGeneration` with `status: completed` and `savedPath`. The returned PNG was verified and copied to the ignored `test-results/codex-probe-image.png` (944,399 bytes). |

Both used the installed default `gpt-6.1-sol` and ChatGPT-managed authentication. Native provider capabilities reported image generation, namespace tools and web search. Model discovery returned a catalog; actual completed inference established access for the selected model. The observed items contained no shell commands, file edits, external MCP calls or child-agent calls. Image generation succeeded with a read-only sandbox and apps, plugins, shell, browser, computer use, delegation and web search disabled for the probe. The native image tool saved its own output under Codex's generated-images directory.

The probe did not read, copy or print `auth.json`, sign in/out, import credentials into ForkBasket, or call the separately billed Images API. It drained diagnostic stderr without saving it and persisted only sanitized metadata. This is proof of a local integration path, not validation of a deployed multi-user service.

To reproduce, use the locked environment and an independently installed Codex binary:

```sh
nix develop --command node scripts/probe-codex.mjs
nix develop --command node scripts/probe-codex.mjs --text --image
```

The first command only reads account/capability/catalog metadata. The second makes one text request and one image request against the signed-in account's usage. Optional `FORKBASKET_CODEX_BINARY` and `FORKBASKET_CODEX_MODEL` select the binary and model explicitly. The project flake currently provides Node but does not package Codex; a deployed connector must pin and package its worker rather than depend on a host installation.

## Supported integration boundaries

**Sign in with ChatGPT (SIWC)** is the documented app-owned OAuth route for eligible ChatGPT plan usage. Its [quickstart](https://developers.openai.com/siwc/quickstart) distinguishes plan permissions from identity-only sign-in. Eligibility for this private application still needs to be established; an existing Codex login does not establish it.

The [registration flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) uses PKCE, state and nonce, a stable host ID, first-time dynamic registration and an issued client ID retained for future connections. Its required loopback callback needs a local helper for a browser that is not running on the homelab server. The [self-hosted guide](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms) documents completing OAuth locally, securely transferring that app's protected credentials, preserving the server's own host ID and letting the server own subsequent refreshes.

Subscription inference uses [streamed Responses](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), rather than the app's existing Chat Completions transport. The [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) require `store: false` and `stream: true`, forbid several ordinary request parameters and exclude hosted image generation. Merely putting SIWC OAuth tokens into an app-server configured for that public API route does not unlock the native Codex image tool tested above.

**Native Codex-managed authentication** is a separate path. The [app-server guide](https://learn.chatgpt.com/docs/app-server) documents client integration and device-code login, but recommends SIWC for app integration and explicitly says app-server authentication has never been permitted for commercial or hosted services. Do not infer a blanket exception for a shared homelab web service from this local test. A local personal companion is the clearer setting for the tested native capabilities. The [image-generation guide](https://learn.chatgpt.com/docs/image-generation) confirms that native generation consumes Codex usage; it recommends the Images API for programmatic generation.

## Recommended design for ForkBasket

Use separate chat and image capabilities, with per-person subscription connections. Preserve the existing owner-configured household API provider. A household member's subscription connection should not automatically lend that person's credentials to everyone else; shared recipes, images and accepted shopping proposals remain ordinary household data.

For the homelab application, prefer an app-owned SIWC connection for subscription chat once eligibility and onboarding are verified. A small desktop setup helper can complete the required loopback flow and transfer the selected ForkBasket credential record directly to its authenticated private HTTPS backend. Keep tokens out of browser storage and household JSON exports, encrypt them on the backend, serialize rotating refreshes, and support disconnect/revocation and clear expiry/usage-limit errors. [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions) describes those token lifecycle requirements. Do not copy this machine's general Codex login into the app.

For subscription images, investigate an opt-in personal Codex companion using the tested stdio protocol. It would poll narrowly scoped jobs from ForkBasket, generate images locally and upload completed image bytes. A short-lived, user-bound worker credential should give it only job retrieval/completion access. The native account remains on that personal runtime. A containerized shared Codex worker is technically plausible but is not the recommended production default given the documented authentication boundary.

Keep image generation explicit initially. A product icon gets a backend-owned illustration template matching the existing food artwork; a recipe gets a separate photography template. Use a small set of trusted style references where supported. Generated icons need crop/alpha/size validation; the successful apple trial did not verify transparency, editing, batches or exact style consistency. Native Codex image generation should appear as a managed capability, without asking users to guess an Images API model ID.

## Implementation work

1. Introduce an AI transport boundary in `backend/src/ai.rs`. Share household context, proposal parsing, validation and revision checks across Chat Completions and subscription Responses. Continue requiring review before applying proposals.
2. Add user-bound encrypted connection records and token lifecycle management. Update `SessionInfo` and settings to distinguish household API access, personal subscription access and actual image availability.
3. Implement SIWC setup/import, model discovery, streaming through a terminal success event, cancellation, backoff and usage-limit handling. Avoid automatic fallback into paid API requests.
4. Prototype the optional local image companion with a pinned Codex version, bounded queues, per-user job ownership, cancellation and retries that cannot duplicate image generation. Accept only native image completion/artifacts; never expose raw app-server RPC to browsers.
5. Route completed images through existing private upload decoding, metadata removal and household storage. Keep the worker away from the app's database, cluster credentials and other household tokens.
6. Validate fresh sign-in, restart/refresh, disconnect, independent wife/owner connections, declined consent, incomplete streams, failed images, job isolation and the actual Nix container. Only then enable the connector in settings or deploy it.

The next implementation decision is which permitted deployment route to target: SIWC subscription chat with the current image API option, or that route plus a personal native Codex image companion. The investigation has demonstrated native chat/images but has not established approval or operational support for running a shared subscription-backed Codex service in Kubernetes.
