import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPair, SignJWT, jwtVerify } from 'jose'
import {
  callbackParameters,
  validateNonce,
  hasPlanPermission,
  consumeResponse,
} from './protocol.mjs'

test('callback rejects forged state, duplicate codes and changed registered client', () => {
  const url = new URL(
    'http://127.0.0.1:1455/auth/callback?state=expected&code=one&client_id=oaiapp_test',
  )
  assert.deepEqual(callbackParameters(url, 'expected'), {
    code: 'one',
    clientId: 'oaiapp_test',
  })
  assert.throws(() => callbackParameters(url, 'forged'), /state mismatch/)
  assert.throws(
    () => callbackParameters(url, 'expected', 'oaiapp_other'),
    /client ID mismatch/,
  )
  url.searchParams.append('code', 'two')
  assert.throws(() => callbackParameters(url, 'expected'), /Duplicate/)
})

test('identity login alone does not authorize plan usage', () => {
  assert.equal(hasPlanPermission('openid profile email'), false)
  assert.equal(
    hasPlanPermission('openid chatgpt.tokens.use.direct.extra'),
    false,
  )
  assert.equal(hasPlanPermission('openid chatgpt.tokens.use.direct'), true)
  assert.throws(
    () => validateNonce({ nonce: 'wrong' }, 'expected'),
    /nonce mismatch/,
  )
})

test('signature verification rejects wrong audience, issuer, expiry and key', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const unrelated = await generateKeyPair('RS256')
  const sign = (
    issuer = 'https://auth.openai.com',
    audience = 'oaiapp_test',
    expiry = '1h',
  ) =>
    new SignJWT({ nonce: 'expected' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('synthetic')
      .setIssuedAt()
      .setExpirationTime(expiry)
      .sign(privateKey)
  const options = {
    issuer: 'https://auth.openai.com',
    audience: 'oaiapp_test',
    algorithms: ['RS256'],
    requiredClaims: ['exp', 'iat', 'sub', 'nonce'],
  }
  const valid = await sign()
  validateNonce(
    (await jwtVerify(valid, publicKey, options)).payload,
    'expected',
  )
  await assert.rejects(
    jwtVerify(await sign('https://wrong.example'), publicKey, options),
  )
  await assert.rejects(
    jwtVerify(await sign(undefined, 'oaiapp_wrong'), publicKey, options),
  )
  await assert.rejects(
    jwtVerify(
      await sign(undefined, undefined, Math.floor(Date.now() / 1000) - 60),
      publicKey,
      options,
    ),
  )
  await assert.rejects(jwtVerify(valid, unrelated.publicKey, options))
})

function stream(events, separator = '\n\n') {
  const bytes = Buffer.from(
    events
      .map((event) => `data: ${JSON.stringify(event)}${separator}`)
      .join(''),
  )
  return (async function* () {
    for (const byte of bytes) yield new Uint8Array([byte])
  })()
}
const delta = { type: 'response.output_text.delta', delta: 'works' }
const complete = {
  type: 'response.completed',
  response: { status: 'completed' },
}

test('image success requires a completed image artifact, not a text reply', async () => {
  await assert.rejects(
    consumeResponse(stream([delta, complete]), { image: true }),
    /without an image artifact/,
  )
  const image = {
    type: 'image_generation_call',
    status: 'completed',
    result: 'synthetic-base64',
  }
  assert.equal(
    await consumeResponse(
      stream([
        {
          type: 'response.completed',
          response: { status: 'completed', output: [image] },
        },
      ]),
      { image: true },
    ),
    'synthetic-base64',
  )
  await assert.rejects(
    consumeResponse(
      stream([
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            output: [{ ...image, status: 'failed' }],
          },
        },
      ]),
      { image: true },
    ),
    /without an image artifact/,
  )
})

test('fragmented LF/CRLF streams require a terminal successful completion', async () => {
  assert.equal(await consumeResponse(stream([delta, complete])), 'works')
  assert.equal(
    await consumeResponse(stream([delta, complete], '\r\n\r\n')),
    'works',
  )
  await assert.rejects(
    consumeResponse(stream([delta])),
    /without response.completed/,
  )
  await assert.rejects(
    consumeResponse(stream([delta, { type: 'response.failed' }])),
    /failure/,
  )
  await assert.rejects(
    consumeResponse(stream([delta, { type: 'response.incomplete' }])),
    /failure/,
  )
  await assert.rejects(
    consumeResponse(stream([delta, complete, { type: 'error' }])),
    /failure/,
  )
})
