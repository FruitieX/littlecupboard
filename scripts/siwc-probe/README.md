# Sign in with ChatGPT availability probe

This standalone tool tests LittleCupboard's own dynamic OAuth registration, identity verification, explicit ChatGPT plan-use permission, model discovery and one tiny synthetic streamed Responses request. It does not reuse Codex authentication or configure the running app. An optional image test checks the hosted `image_generation` tool even though the SIWC preview documents it as unsupported.

From the LittleCupboard repository:

```sh
nix develop --command npm ci --prefix scripts/siwc-probe --ignore-scripts
nix develop --command npm test --prefix scripts/siwc-probe
nix develop --command node scripts/siwc-probe/index.mjs
nix develop --command node scripts/siwc-probe/index.mjs --image
```

The listener binds only `127.0.0.1:1455`. If the browser is on another machine, first forward its port to the machine running the probe:

```sh
ssh -N -o ExitOnForwardFailure=yes -L 1455:127.0.0.1:1455 user@probe-host
```

Leave that connection open, open the authorization URL printed by the probe, and complete browser consent within 15 minutes. Never paste callback URLs or tokens into chat. The probe validates state, PKCE, the issued client ID, the ID token's signature/issuer/audience/expiry/nonce, and the token response's plan-use scope. Streamed text counts as success only after `response.completed`; partial output followed by a failure does not count.

`--image` also requests a simple apple illustration through public Responses, forcing the hosted image-generation tool. It requires a successful terminal event, a completed image output item and a PNG artifact; a text description does not count. If successful, `image-result.png` is saved in the private probe directory below. The sanitized report records image results separately from text success. No API-key fallback or native Codex authentication is used.

Tokens and authorization codes remain in process memory. On exit, the probe attempts to revoke the refresh-token session and reports whether revocation was confirmed. If it cannot confirm revocation, remove the test connection in ChatGPT's connected-app settings. No credentials are saved for importing into production.

Only a stable host ID, the verified registration's client ID, and a sanitized last-result report are stored in `~/.config/littlecupboard/siwc-probe`, outside Git, with mode-0600 files in a mode-0700 directory. Later runs reuse the registered client; this is a single-user test helper, not multi-account onboarding. `LITTLECUPBOARD_SIWC_MODEL` can select a visible model explicitly; otherwise the helper chooses `gpt-6.1-sol` if available, then the first visible model.

A successful request establishes technical access for the tested account and registration. It does not establish blanket eligibility for a private remotely hosted application or permission to share one person's plan among household members. Consult the official [registration flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [inference guide](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [eligibility overview](https://developers.openai.com/siwc/quickstart) and [preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) before implementing a deployed connection.
