import { timingSafeEqual } from 'node:crypto'

export function callbackParameters(url, expectedState, registeredClientId) {
  for (const key of ['state', 'code', 'client_id', 'error']) {
    if (url.searchParams.getAll(key).length > 1)
      throw new Error('Duplicate callback parameter')
  }
  const state = Buffer.from(url.searchParams.get('state') ?? '')
  const expected = Buffer.from(expectedState)
  if (state.length !== expected.length || !timingSafeEqual(state, expected))
    throw new Error('Callback state mismatch')
  const error = url.searchParams.get('error')
  if (error) return { error }
  const code = url.searchParams.get('code')
  const clientId = url.searchParams.get('client_id') ?? registeredClientId
  if (!code || !/^oaiapp_[A-Za-z0-9_-]+$/.test(clientId ?? ''))
    throw new Error('Missing code or issued client ID')
  if (registeredClientId && clientId !== registeredClientId)
    throw new Error('Callback client ID mismatch')
  return { code, clientId }
}

export function validateNonce(payload, nonce) {
  if (payload.nonce !== nonce) throw new Error('ID token nonce mismatch')
}

export function hasPlanPermission(scope) {
  return (
    typeof scope === 'string' &&
    scope.split(/\s+/).includes('chatgpt.tokens.use.direct')
  )
}

export async function consumeResponse(body, { image = false } = {}) {
  const decoder = new TextDecoder()
  let buffer = ''
  let bytes = 0
  let completed = false
  let output = ''
  let imageResult
  const process = (event) => {
    const data = event
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data || data === '[DONE]') return
    const parsed = JSON.parse(data)
    if (
      ['error', 'response.failed', 'response.incomplete'].includes(parsed.type)
    )
      throw new Error('Inference stream reported failure')
    if (parsed.type === 'response.output_text.delta')
      output += parsed.delta ?? ''
    if (parsed.type === 'response.completed') {
      if (parsed.response?.status !== 'completed')
        throw new Error('Invalid completion status')
      completed = true
      imageResult = parsed.response.output?.find(
        (item) =>
          item.type === 'image_generation_call' && item.status === 'completed',
      )?.result
    }
  }
  for await (const chunk of body) {
    bytes += chunk.byteLength
    if (bytes > (image ? 20 : 1) * 1024 * 1024)
      throw new Error('Inference stream exceeded probe limit')
    buffer += decoder.decode(chunk, { stream: true })
    buffer = buffer.replace(/\r\n/g, '\n')
    let index
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      process(buffer.slice(0, index))
      buffer = buffer.slice(index + 2)
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) process(buffer)
  if (!completed) throw new Error('Inference ended without response.completed')
  if (image) {
    if (typeof imageResult !== 'string' || !imageResult)
      throw new Error('Inference completed without an image artifact')
    return imageResult
  }
  if (!output.trim()) throw new Error('Inference completed without text')
  return output
}
