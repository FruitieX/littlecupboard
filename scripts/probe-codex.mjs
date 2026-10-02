// Investigates the installed Codex protocol; this is not a production worker.
// Uses Codex's existing login without reading or copying its credentials.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import {
  mkdtemp,
  readFile,
  realpath,
  stat,
  writeFile,
  chmod,
  mkdir,
  rmdir,
} from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { createInterface } from 'node:readline'

const modes = new Set(process.argv.slice(2))
assert.ok(
  [...modes].every((mode) => ['--text', '--image'].includes(mode)),
  'Usage: node scripts/probe-codex.mjs [--text] [--image]',
)
const binary = process.env.LITTLECUPBOARD_CODEX_BINARY || 'codex'
const workspace = await mkdtemp(join(tmpdir(), 'littlecupboard-codex-probe-'))
await mkdir('test-results', { recursive: true })
const pending = new Map()
const notifications = []
let sequence = 0
const report = {
  version: execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim(),
  authentication: null,
  providerCapabilities: null,
  models: [],
  trials: [],
}
const child = spawn(
  binary,
  [
    'app-server',
    '--listen',
    'stdio://',
    '--disable',
    'apps',
    '--disable',
    'plugins',
    '--disable',
    'shell_tool',
    '--disable',
    'browser_use',
    '--disable',
    'computer_use',
    '--disable',
    'multi_agent',
    '-c',
    'web_search="disabled"',
  ],
  { cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'] },
)
// Drain diagnostic output without persisting potentially sensitive logs.
child.stderr.resume()
const lines = createInterface({ input: child.stdout })
const send = (message) => child.stdin.write(JSON.stringify(message) + '\n')
function request(method, params = {}, timeout = 30_000) {
  const id = ++sequence
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Codex timed out: ${method}`))
    }, timeout)
    pending.set(id, { method, resolve, reject, timer })
    send({ id, method, params })
  })
}
lines.on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (message.method && message.id !== undefined) {
    // Never approve shell, filesystem, account, or external-tool requests.
    send({
      id: message.id,
      error: { code: -32601, message: 'Unsupported by the probe' },
    })
  } else if (message.id !== undefined) {
    const call = pending.get(message.id)
    if (!call) return
    clearTimeout(call.timer)
    pending.delete(message.id)
    if (message.error)
      call.reject(
        new Error(`${call.method} failed (RPC code ${message.error.code})`),
      )
    else call.resolve(message.result)
  } else if (
    message.method === 'turn/completed' ||
    message.method === 'item/completed'
  ) {
    notifications.push(message)
  }
})
child.on('error', (error) => {
  for (const call of pending.values()) {
    clearTimeout(call.timer)
    call.reject(error)
  }
  pending.clear()
})
child.on('exit', () => {
  for (const call of pending.values()) {
    clearTimeout(call.timer)
    call.reject(new Error(`Codex exited during ${call.method}`))
  }
  pending.clear()
})
async function trial(kind, prompt, outputSchema) {
  const thread = await request('thread/start', {
    cwd: workspace,
    ephemeral: true,
    sandbox: 'read-only',
    approvalPolicy: 'never',
    environments: [],
    ...(process.env.LITTLECUPBOARD_CODEX_MODEL
      ? { model: process.env.LITTLECUPBOARD_CODEX_MODEL }
      : {}),
    baseInstructions:
      'You are an integration test for a family shopping app. Use only the supplied synthetic data. Do not read files, run commands, use external apps, browse, or delegate. Use the built-in image-generation tool only if explicitly requested. Never substitute another image API or an SVG.',
    developerInstructions:
      'No repository work or configuration changes. Answer concisely. Do not reveal account or authentication details.',
  })
  const threadId = thread.thread.id
  const started = Date.now()
  const turn = await request('turn/start', {
    threadId,
    input: [{ type: 'text', text: prompt }],
    ...(outputSchema ? { outputSchema } : {}),
  })
  let completed
  while (Date.now() - started < (kind === 'image' ? 240_000 : 90_000)) {
    completed = notifications.find(
      (event) =>
        event.method === 'turn/completed' &&
        event.params.threadId === threadId &&
        event.params.turn.id === turn.turn.id,
    )
    if (completed) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (!completed) {
    await request('turn/interrupt', { threadId, turnId: turn.turn.id }).catch(
      () => {},
    )
    throw new Error(`The ${kind} trial did not complete in time`)
  }
  const items = notifications
    .filter(
      (event) =>
        event.method === 'item/completed' &&
        event.params.threadId === threadId &&
        event.params.turnId === turn.turn.id,
    )
    .map((event) => event.params.item)
  const result = {
    kind,
    model: thread.model,
    status: completed.params.turn.status,
    durationSeconds: Math.round((Date.now() - started) / 1000),
    itemTypes: [...new Set(items.map((item) => item.type))],
  }
  if (kind === 'text') {
    const messages = items.filter((item) => item.type === 'agentMessage')
    const proposal = JSON.parse(messages.at(-1)?.text || 'null')
    assert.equal(result.status, 'completed')
    assert.equal(proposal?.shopping?.[0]?.productId, 'apples')
    assert.equal(proposal?.shopping?.[0]?.quantity, 4)
    assert.deepEqual(proposal.recipes, [])
    assert.deepEqual(proposal.plan, [])
    result.validProposal = true
  } else {
    const image = items.find((item) => item.type === 'imageGeneration')
    result.imageStatus = image?.status || null
    result.imageFailureType = image?.failure?.type || null
    if (image?.savedPath && image.status === 'completed') {
      const root = await realpath(
        join(
          process.env.CODEX_HOME || join(homedir(), '.codex'),
          'generated_images',
        ),
      )
      const path = await realpath(image.savedPath)
      const subpath = relative(root, path)
      assert.ok(
        subpath &&
          subpath !== '..' &&
          !subpath.startsWith('../') &&
          !isAbsolute(subpath),
        'Image must be inside Codex generated_images',
      )
      const info = await stat(path)
      assert.ok(
        info.isFile() && info.size > 100 && info.size <= 20 * 1024 * 1024,
      )
      const bytes = await readFile(path)
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG')
      const destination = resolve('test-results/codex-probe-image.png')
      await writeFile(destination, bytes, { mode: 0o600 })
      await chmod(destination, 0o600)
      result.imageVerified = true
      result.imageBytes = info.size
      result.artifact = 'test-results/codex-probe-image.png'
    } else {
      result.imageVerified = false
    }
  }
  report.trials.push(result)
  assert.equal(result.status, 'completed')
  assert.ok(
    !result.itemTypes.some((type) =>
      [
        'commandExecution',
        'fileChange',
        'mcpToolCall',
        'dynamicToolCall',
        'collabToolCall',
      ].includes(type),
    ),
    'No unrelated tools should run',
  )
  if (kind === 'image')
    assert.equal(
      result.imageVerified,
      true,
      'No native image artifact was returned',
    )
  console.log(JSON.stringify({ trial: result }, null, 2))
}
try {
  await request('initialize', {
    clientInfo: {
      name: 'littlecupboard_probe',
      title: 'LittleCupboard integration investigation',
      version: '0.1.0',
    },
    capabilities: { experimentalApi: true },
  })
  send({ method: 'initialized', params: {} })
  const account = await request('account/read', { refreshToken: false })
  report.authentication = account.account?.type || 'not-connected'
  report.providerCapabilities = await request('modelProvider/capabilities/read')
  const catalog = await request('model/list', { limit: 30 })
  report.models = catalog.data.map(({ model, isDefault }) => ({
    model,
    isDefault,
  }))
  console.log(JSON.stringify({ ...report, trials: undefined }, null, 2))
  if (modes.size)
    assert.equal(
      report.authentication,
      'chatgpt',
      'Trials require an existing ChatGPT login',
    )
  if (modes.has('--text')) {
    const ingredient = {
      type: 'object',
      additionalProperties: false,
      required: ['productId', 'quantity', 'unit', 'note'],
      properties: {
        productId: { type: 'string' },
        quantity: { type: 'number' },
        unit: { type: 'string' },
        note: { type: 'string' },
      },
    }
    await trial(
      'text',
      'Propose adding four apples for lunches. The known product ID is apples. Return a message and shopping, recipes and plan arrays; no recipes or meal changes. Do not apply anything.',
      {
        type: 'object',
        additionalProperties: false,
        required: ['message', 'shopping', 'recipes', 'plan'],
        properties: {
          message: { type: 'string' },
          shopping: { type: 'array', items: ingredient },
          recipes: { type: 'array', items: { type: 'string' } },
          plan: { type: 'array', items: { type: 'string' } },
        },
      },
    )
  }
  if (modes.has('--image')) {
    assert.equal(report.providerCapabilities.imageGeneration, true)
    await trial(
      'image',
      'Use your built-in image-generation tool to create exactly one simple square shopping-list illustration of a red apple: friendly emoji-like artwork, rounded shapes, clean outlines, restrained colors, centered on a plain cream background, no lettering or logos. This tests the native tool; do not use an API key, shell, external tools, SVG, or fallback. If the native tool is unavailable, say so. Do not edit any files. After generation, give one brief sentence.',
    )
  }
  await writeFile(
    resolve('test-results/codex-probe-report.json'),
    JSON.stringify(report, null, 2) + '\n',
    { mode: 0o600 },
  )
  console.log(JSON.stringify({ trials: report.trials }, null, 2))
} finally {
  lines.close()
  child.stdin.end()
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000)
  timer.unref()
  await rmdir(workspace).catch(() => {})
}
