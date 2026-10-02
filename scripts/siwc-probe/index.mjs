import http from 'node:http'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import {
  callbackParameters,
  validateNonce,
  hasPlanPermission,
  consumeResponse,
} from './protocol.mjs'

const issuer = 'https://auth.openai.com'
const resource = 'https://api.openai.com/v1'
const redirectUri = 'http://127.0.0.1:1455/auth/callback'
const imageTest = process.argv.includes('--image')
const directory = join(homedir(), '.config/littlecupboard/siwc-probe')
const state = randomBytes(32).toString('base64url')
const nonce = randomBytes(32).toString('base64url')
const verifier = randomBytes(48).toString('base64url')
const controller = new AbortController()
let refreshToken
let clientId
let metadata
let server
let timeout
let report = { testedAt: new Date().toISOString(), success: false }
const stop = () => controller.abort()
process.once('SIGINT', stop)
process.once('SIGTERM', stop)

function providerEndpoint(value) {
  const url = new URL(value)
  if (url.origin !== issuer)
    throw new Error('Unexpected authentication endpoint')
  return url
}

async function checked(response, phase) {
  if (response.ok) return response
  let code
  try {
    const body = await response.json()
    const candidate = body.error?.code ?? body.code
    if (
      typeof candidate === 'string' &&
      /^[a-zA-Z0-9_-]{1,100}$/.test(candidate)
    )
      code = candidate
  } catch {}
  report.failure = { phase, status: response.status, ...(code ? { code } : {}) }
  throw new Error(
    `${phase}: HTTP ${response.status}${code ? ` (${code})` : ''}`,
  )
}

async function request(url, options = {}) {
  return fetch(url, {
    ...options,
    signal: AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(imageTest ? 240_000 : 90_000),
    ]),
  })
}

try {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  let host
  let registeredClientId
  try {
    host = JSON.parse(await readFile(join(directory, 'host.json'), 'utf8'))
    if (!/^urn:uuid:[0-9a-f-]{36}$/.test(host.hostId))
      throw new Error('Invalid saved host ID')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    host = { hostId: `urn:uuid:${randomUUID()}` }
    await writeFile(join(directory, 'host.json'), JSON.stringify(host), {
      mode: 0o600,
      flag: 'wx',
    })
  }
  try {
    const registration = JSON.parse(
      await readFile(join(directory, 'registration.json'), 'utf8'),
    )
    if (
      registration.hostId !== host.hostId ||
      !/^oaiapp_[A-Za-z0-9_-]+$/.test(registration.clientId)
    )
      throw new Error('Invalid saved registration')
    registeredClientId = registration.clientId
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  metadata = await (
    await checked(
      await request(`${issuer}/.well-known/openid-configuration`),
      'discovery',
    )
  ).json()
  if (metadata.issuer !== issuer) throw new Error('Unexpected OAuth issuer')
  for (const key of [
    'authorization_endpoint',
    'token_endpoint',
    'jwks_uri',
    'revocation_endpoint',
  ])
    providerEndpoint(metadata[key])

  const callback = new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const headers = {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'",
      }
      if (
        req.method !== 'GET' ||
        req.headers.host !== '127.0.0.1:1455' ||
        req.url.length > 8192
      ) {
        res.writeHead(400, headers).end('Invalid callback request.')
        return
      }
      const url = new URL(req.url, redirectUri)
      if (url.pathname !== '/auth/callback') {
        res.writeHead(404, headers).end('Not found.')
        return
      }
      let parameters
      try {
        parameters = callbackParameters(url, state, registeredClientId)
      } catch {
        res
          .writeHead(400, headers)
          .end('Invalid sign-in callback. Return to the original sign-in page.')
        return
      }
      res
        .writeHead(200, headers)
        .end(
          parameters.error
            ? 'Sign-in was declined. Return to your terminal.'
            : 'Sign-in received. Return to your terminal for the test result. You can close this tab.',
        )
      server.close()
      resolve(parameters)
    })
    server.once('error', reject)
    controller.signal.addEventListener(
      'abort',
      () => reject(new Error('Probe cancelled or timed out')),
      { once: true },
    )
  })
  // Handle an early listener error without an unhandled rejection.
  callback.catch(() => {})
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(1455, '127.0.0.1', resolve)
  })
  timeout = setTimeout(stop, 15 * 60_000)
  const authorization = providerEndpoint(metadata.authorization_endpoint)
  authorization.search = new URLSearchParams({
    client_id: registeredClientId ?? 'dynamic_agent_client',
    ext_agent_host_id: host.hostId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope:
      'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
    resource,
    state,
    nonce,
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  })
  if (!registeredClientId)
    authorization.searchParams.set('agent_name_hint', 'LittleCupboard')
  console.log(
    'Callback listening on 127.0.0.1:1455; browser consent required (15 minute timeout).\n' +
      authorization.href,
  )
  const result = await callback
  if (result.error)
    throw new Error('Browser authorization was declined or failed')
  clientId = result.clientId
  const tokenResponse = await checked(
    await request(metadata.token_endpoint, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code: result.code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        resource,
      }),
    }),
    'token exchange',
  )
  const tokens = await tokenResponse.json()
  refreshToken = tokens.refresh_token
  if (
    !tokens.id_token ||
    !tokens.access_token ||
    tokens.token_type?.toLowerCase() !== 'bearer'
  )
    throw new Error('Incomplete OAuth token response')
  const { payload } = await jwtVerify(
    tokens.id_token,
    createRemoteJWKSet(providerEndpoint(metadata.jwks_uri)),
    {
      issuer,
      audience: clientId,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'sub', 'nonce'],
    },
  )
  validateNonce(payload, nonce)
  report.identityVerified = true
  report.planPermission = hasPlanPermission(tokens.scope)
  if (!report.planPermission)
    throw new Error('Sign-in succeeded but plan-use permission was not granted')
  await writeFile(
    join(directory, 'registration.json'),
    JSON.stringify({ clientId, hostId: host.hostId }),
    { mode: 0o600 },
  )
  const headers = { Authorization: `Bearer ${tokens.access_token}` }
  const catalog = await (
    await checked(
      await request(`${resource}/models`, { headers }),
      'model catalog',
    )
  ).json()
  const models =
    catalog.models?.filter(
      (model) => model.visibility === 'list' && typeof model.slug === 'string',
    ) ?? []
  const model =
    process.env.LITTLECUPBOARD_SIWC_MODEL ??
    models.find((entry) => entry.slug === 'gpt-6.1-sol')?.slug ??
    models[0]?.slug
  if (!model || !models.some((entry) => entry.slug === model))
    throw new Error('No matching visible model in subscription catalog')
  report.model = model
  const response = await checked(
    await request(`${resource}/responses`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        store: false,
        stream: true,
        input: [
          {
            role: 'user',
            content: 'Reply with exactly: LittleCupboard connection works.',
          },
        ],
      }),
    }),
    'subscription inference',
  )
  const output = await consumeResponse(response.body)
  report.success = output.trim() === 'LittleCupboard connection works.'
  if (!report.success)
    throw new Error(
      'Completed inference did not match the synthetic test reply',
    )
  console.log(
    'Verified identity, plan permission and completed subscription text inference.',
  )
  if (imageTest) {
    console.log(
      'Testing hosted image_generation through subscription Responses...',
    )
    report.image = { attempted: true, success: false }
    const response = await checked(
      await request(`${resource}/responses`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          store: false,
          stream: true,
          input: [
            {
              role: 'user',
              content:
                'Generate an image of a single red apple with a leaf, a friendly soft illustration on a warm cream background, no text.',
            },
          ],
          tools: [{ type: 'image_generation' }],
          tool_choice: { type: 'image_generation' },
        }),
      }),
      'subscription image generation',
    )
    const base64 = await consumeResponse(response.body, { image: true })
    const bytes = Buffer.from(base64, 'base64')
    if (
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw new Error('Invalid generated PNG artifact')
    await writeFile(join(directory, 'image-result.png'), bytes, { mode: 0o600 })
    report.image = { attempted: true, success: true, bytes: bytes.length }
    console.log(
      'Completed subscription image generation; PNG saved outside Git.',
    )
  }
} catch (error) {
  // Never log provider bodies, JWTs, callback URLs, account identifiers or stack traces.
  const safeMessages =
    /^(Unexpected|Invalid|Missing|Duplicate|Callback|ID token nonce|Inference|Incomplete OAuth|Sign-in succeeded|No matching|Completed inference|Browser authorization|Probe cancelled|discovery:|token exchange:|model catalog:|subscription inference:|subscription image generation:)/
  const message = safeMessages.test(error.message ?? '')
    ? error.message
    : `Probe failed (${String(error.code ?? error.name)
        .replace(/[^A-Za-z0-9_-]/g, '')
        .slice(0, 80)})`
  report.message = message
  console.error(message)
  process.exitCode = 1
} finally {
  clearTimeout(timeout)
  server?.close()
  if (refreshToken && clientId && metadata) {
    try {
      const response = await fetch(
        providerEndpoint(metadata.revocation_endpoint),
        {
          method: 'POST',
          signal: AbortSignal.timeout(30_000),
          body: new URLSearchParams({
            token: refreshToken,
            token_type_hint: 'refresh_token',
            client_id: clientId,
          }),
        },
      )
      report.sessionRevoked = response.ok
    } catch {
      report.sessionRevoked = false
    }
    console.log(
      report.sessionRevoked
        ? 'Test session revoked; no tokens saved.'
        : 'Could not confirm session revocation. Remove LittleCupboard from ChatGPT connected apps if necessary; no tokens saved.',
    )
  }
  await writeFile(
    join(directory, 'last-result.json'),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  ).catch(() => {})
  console.log(JSON.stringify(report, null, 2))
}
