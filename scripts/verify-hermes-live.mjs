// Explicit live smoke test against a synthetic, disposable household only.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, readFile, writeFile, unlink } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { launchBrowser, settle } from './browser.mjs'
assert.equal(
  process.env.FORKBASKET_HERMES_LIVE,
  '1',
  'Set FORKBASKET_HERMES_LIVE=1 for personal subscription calls',
)
const folder = await mkdtemp(join(tmpdir(), 'forkbasket-hermes-'))
const origin = 'http://127.0.0.1:3310'
const pairingFile = join(
  homedir(),
  '.hermes/profiles/forkbasket/forkbasket-companion.json',
)
let previous
try {
  previous = await readFile(pairingFile)
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
const children = []
let browser
let cookie = ''
const systemd = process.env.FORKBASKET_HERMES_SYSTEMD === '1'
async function service(action) {
  const child = spawn('systemctl', ['--user', action, 'forkbasket-companion'], {
    stdio: 'ignore',
  })
  assert.equal(
    await new Promise((resolve) => child.once('exit', resolve)),
    0,
    `Companion service ${action} failed`,
  )
}
function start(args, env = {}) {
  const child = spawn(args[0], args.slice(1), {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  child.stdout.on('data', (chunk) => {
    for (const line of chunk.toString().split('\n')) {
      try {
        const report = JSON.parse(line)
        if (report.phase === 'job-failed') console.log(JSON.stringify(report))
      } catch {}
    }
  })
  children.push(child)
  return child
}
async function api(path, body, method = 'POST') {
  const response = await fetch(origin + '/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-ForkBasket-Request': '1',
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (path === '/auth/setup')
    cookie = response.headers.get('set-cookie').split(';')[0]
  const result = await response.json()
  assert.ok(response.ok, `${path}: ${result.message || response.status}`)
  return result
}
try {
  start(['cargo', 'run', '--manifest-path', 'backend/Cargo.toml'], {
    FORKBASKET_BIND: '127.0.0.1:3310',
    FORKBASKET_DATA_DIR: folder,
    FORKBASKET_ORIGIN: origin,
    FORKBASKET_STATIC_DIR: 'dist/client',
    FORKBASKET_SETUP_TOKEN: 'synthetic-household-setup',
  })
  const until = Date.now() + 90000
  while (true) {
    try {
      if ((await fetch(origin + '/api/ready')).ok) break
    } catch {}
    assert.ok(Date.now() < until, 'Local app did not start')
    await new Promise((r) => setTimeout(r, 300))
  }
  await api('/auth/setup', {
    setupToken: 'synthetic-household-setup',
    email: 'hermes@example.test',
    name: 'Hermes test',
    password: 'synthetic household password',
    householdName: 'Synthetic Hermes test',
    samples: true,
    timeZone: 'Europe/Helsinki',
  })
  const { token } = await api('/ai/companion', {})
  const setup = start([
    process.execPath,
    'scripts/hermes-companion.mjs',
    '--profile',
    'forkbasket',
    '--pair-stdin',
  ])
  setup.stdin.end(JSON.stringify({ url: origin, token }))
  assert.equal(
    await new Promise((r) => setup.once('exit', r)),
    0,
    'Companion setup failed',
  )
  if (systemd) await service('restart')
  else
    start([
      process.execPath,
      'scripts/hermes-companion.mjs',
      '--profile',
      'forkbasket',
    ])
  const config = {
    enabled: true,
    transport: 'companion',
    model: 'gpt-6-luna',
    reasoningEffort: 'xhigh',
    baseUrl: 'https://api.openai.com/v1',
    imageModel: 'gpt-image-2-medium',
    imageSize: '1024x1024',
    responseFormat: 'schema',
    tokenParameter: 'omit',
  }
  await api('/ai/config', { config }, 'PUT')
  for (let i = 0; i < 30; i++) {
    if ((await api('/ai/config', undefined, 'GET')).companion.online) break
    assert.ok(i < 29, 'Companion did not become online')
    await new Promise((r) => setTimeout(r, 500))
  }
  console.log('Personal companion paired with synthetic household.')
  if (process.env.FORKBASKET_HERMES_UI_ONLY !== '1') {
    await api('/ai/test', { config })
    console.log('gpt-6-luna xhigh connection test passed.')
    const proposal = await api('/ai/assistant', {
      prompt:
        'Suggest buying one litre of oat milk. Do not propose recipes or a meal plan.',
    })
    assert.ok(proposal.shopping.length > 0)
    assert.ok(proposal.message)
    assert.equal(proposal.recipes.length, 0)
    const state = await api('/state', undefined, 'GET')
    assert.ok(
      !state.state.items.some(
        (item) => item.name === 'Oat milk' && !item.checked,
      ),
      'Assistant must await review',
    )
    console.log(
      'Live schema-constrained proposal passed; shopping remains unchanged before review.',
    )
    const picture = await api('/ai/image', {
      prompt:
        'A single ripe pear centered on warm ivory, friendly soft clay illustration for a shopping tile. Gentle shadow, no text, no border.',
    })
    assert.match(picture.url, /^\/api\/images\//)
    const image = await fetch(origin + picture.url, {
      headers: { Cookie: cookie },
    })
    assert.ok(
      image.ok && image.headers.get('content-type').startsWith('image/'),
    )
    const outsider = await fetch(origin + picture.url)
    assert.equal(outsider.status, 401)
    await writeFile(
      'test-results/hermes-live-private-image.jpg',
      Buffer.from(await image.arrayBuffer()),
    )
    console.log('Live native image persisted as a private app attachment.')
  }
  browser = await launchBrowser()
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  })
  const [name, value] = cookie.split('=')
  await context.addCookies([{ name, value, url: origin }])
  const page = await context.newPage()
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto(origin + '/settings')
    await settle(page)
    await page.getByText('Configure AI assistant', { exact: true }).click()
    assert.equal(
      await page.getByLabel('Connection', { exact: true }).inputValue(),
      'companion',
    )
    assert.equal(
      await page.getByLabel('Reasoning effort', { exact: true }).inputValue(),
      'xhigh',
    )
    assert.equal(
      await page.getByLabel('Chat model', { exact: true }).inputValue(),
      'gpt-6-luna',
    )
    await page.getByText('Companion online', { exact: true }).waitFor()
    await page
      .locator('.ai-provider-card')
      .screenshot({ path: `test-results/hermes-settings-${width}.png` })
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    )
  }
  console.log(
    'Companion settings and reasoning selection passed mobile/desktop browser checks.',
  )
} finally {
  if (browser) await browser.close()
  if (systemd) await service('stop')
  for (const child of children)
    if (child.exitCode === null) child.kill('SIGTERM')
  await Promise.all(
    children
      .filter((child) => child.exitCode === null)
      .map((child) => new Promise((resolve) => child.once('exit', resolve))),
  )
  if (previous) await writeFile(pairingFile, previous, { mode: 0o600 })
  else await unlink(pairingFile).catch(() => {})
  await rm(folder, { recursive: true, force: true })
}
