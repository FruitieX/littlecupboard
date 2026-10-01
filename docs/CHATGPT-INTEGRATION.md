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

### Direct SIWC availability check

The standalone [SIWC probe](../scripts/siwc-probe/README.md) implements the official first-time dynamic registration with an app-owned host ID, a loopback callback reachable through an SSH tunnel, PKCE/state/nonce and JWKS-backed ID-token validation. It checks the granted plan-use scope and makes one small streamed text request against the public Responses route. Tokens remain in memory and the test session is revoked afterward; only registration metadata and a sanitized result are persisted outside Git. Its negative checks cover forged/duplicate callbacks, changed client IDs, invalid JWT signatures/claims, missing plan permission, fragmented SSE and incomplete/failed streams.

The real browser sign-in test completed successfully on 2026-10-01 through an SSH tunnel to Pear. The issued ID token passed verification, the token response granted `chatgpt.tokens.use.direct`, and model discovery selected `gpt-6-astra`. One public Responses request returned the exact synthetic reply and reached `response.completed`. Refresh-token session revocation succeeded afterward; no tokens were saved. This establishes technical subscription-text access for the tested account and app registration. It does not by itself establish general eligibility for a private remotely hosted application, multi-user onboarding or subscription images. Production remains unchanged.

At the user's request, a second browser sign-in reused the issued registration and tested images as well. Text inference completed again with `gpt-6-astra`. A public Responses request with `tools: [{type: "image_generation"}]` and forced image tool selection was rejected with HTTP 400 and `subscription_sharing_unsupported_capability`. No image was returned. Session revocation succeeded again. This is a live capability failure on the SIWC route, distinct from the earlier successful native Codex image trial. The optional `--image` probe records image success separately, and accepts only a completed image output with a PNG artifact. There was no fallback to paid API credentials or native authentication.

**Sign in with ChatGPT (SIWC)** is the documented app-owned OAuth route for eligible ChatGPT plan usage. Its [quickstart](https://developers.openai.com/siwc/quickstart) distinguishes plan permissions from identity-only sign-in. The probe now establishes technical access for this registration/account; the documented private/remote deployment eligibility still needs to be settled separately. An existing Codex login does not establish SIWC eligibility.

The [registration flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) uses PKCE, state and nonce, a stable host ID, first-time dynamic registration and an issued client ID retained for future connections. Its required loopback callback needs a local helper for a browser that is not running on the homelab server. The [self-hosted guide](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms) documents completing OAuth locally, securely transferring that app's protected credentials, preserving the server's own host ID and letting the server own subsequent refreshes.

Subscription inference uses [streamed Responses](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), rather than the app's existing Chat Completions transport. The [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) require `store: false` and `stream: true`, forbid several ordinary request parameters and exclude hosted image generation. Merely putting SIWC OAuth tokens into an app-server configured for that public API route does not unlock the native Codex image tool tested above.

**Native Codex-managed authentication** is a separate path. The [app-server guide](https://learn.chatgpt.com/docs/app-server) documents client integration and device-code login, but recommends SIWC for app integration and explicitly says app-server authentication has never been permitted for commercial or hosted services. Do not infer a blanket exception for a shared homelab web service from this local test. A local personal companion is the clearer setting for the tested native capabilities. The [image-generation guide](https://learn.chatgpt.com/docs/image-generation) confirms that native generation consumes Codex usage; it recommends the Images API for programmatic generation.

## Recommended design for ForkBasket

### Hermes companion investigation

The user plans a 24/7 personal Hermes agent on a machine outside the homelab. Hermes's [image provider documentation](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/image-generation.md) describes an `openai-codex` backend using native Codex image generation/edit endpoints, separate from SIWC Responses. The installed source on Pear contains that provider and its own Codex OAuth device/browser login flow. This is a third-party implementation, not evidence that OpenAI supports those endpoints as a general hosted image API.

The standalone `scripts/probe-hermes.mjs` runs a small Python probe using Hermes's published runtime command and its existing pinned dependency bootstrap. It invokes only the native image provider, without changing the configured image provider, enabling plugins, starting an agent conversation or exporting credentials. Diagnostics are filtered; only safe capability/results metadata and synthetic image artifacts are retained under ignored `test-results/hermes-probe`. There is no fallback to another provider. Default mode checks availability; `--images` attempts a shopping icon, recipe photograph and reference-guided icon, stopping on the first failure and decoding any returned image before counting success.

```sh
nix develop --command node scripts/probe-hermes.mjs
nix develop --command node scripts/probe-hermes.mjs --images
```

On 2026-10-01, the local Hermes CLI reported `openai-codex: logged in`; the probe confirmed a native Codex route and available image provider. Its actual first image request returned HTTP 401 (`api_error`) in 0.1 seconds. No image was returned, and the other two requests were skipped. This does not establish whether the credential is stale or the native route rejects that session. A fresh Hermes-owned OAuth sign-in is the next diagnostic step, followed by rerunning the same bounded probe. The existing successful native Codex-client trial used a different runtime/session.

For local testing, no credentials need to be sent to the coding agent: run Hermes's OAuth login in the user's own terminal and leave authentication in Hermes. A fresh, explicitly prioritized test entry can be created with `hermes auth add openai-codex --type oauth --priority 0 --label forkbasket-image-test`. For a different machine, provide an SSH destination reachable from Pear and the selected Hermes profile; authenticate Hermes on that machine. Do not transfer auth files, bearer tokens or passwords through chat, and do not expose a raw agent server publicly.

The proposed production bridge remains a scoped image-job queue: ForkBasket queues user-owned jobs, a worker on the personal agent machine claims them through private HTTPS/VPN access, invokes a selected local image provider and uploads validated artifacts. Credentials stay on the personal machine. Use stored style prompts/references, bounded concurrency, explicit job failures and deduplication. Sharing household artifacts is separate from sharing a person's subscription credentials; moving the worker outside Kubernetes does not establish a hosted-service authentication exception.

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
