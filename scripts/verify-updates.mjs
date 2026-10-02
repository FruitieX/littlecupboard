import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchBrowser, settle } from './browser.mjs'

const directory = await mkdtemp(join(tmpdir(), 'littlecupboard-update-'))
const staticDirectory = join(directory, 'static')
const origin = 'http://127.0.0.1:3412'
await cp('dist/client', staticDirectory, { recursive: true })
const shell = await readFile(join(staticDirectory, '_shell.html'), 'utf8')
const worker = await readFile(join(staticDirectory, 'sw.js'), 'utf8')
const oldAsset = '/assets/old-release-fixture.js'
async function release(name, includeOld) {
  await writeFile(
    join(staticDirectory, '_shell.html'),
    shell.replace(
      '</head>',
      `<meta name="test-release" content="${name}"></head>`,
    ),
  )
  let next = worker.replace(
    /const CACHE='[^']+'/,
    `const CACHE='littlecupboard-shell-fixture-${name}'`,
  )
  if (includeOld) {
    await writeFile(
      join(staticDirectory, oldAsset.slice(1)),
      'previous release asset',
    )
    next = next.replace(
      'const ASSETS=[',
      `const ASSETS=[${JSON.stringify(oldAsset)},`,
    )
  } else await rm(join(staticDirectory, oldAsset.slice(1)), { force: true })
  await writeFile(join(staticDirectory, 'sw.js'), next)
}
await release('first', true)
const logs = []
const server = spawn(
  'cargo',
  ['run', '--manifest-path', 'backend/Cargo.toml'],
  {
    env: {
      ...process.env,
      LITTLECUPBOARD_BIND: '127.0.0.1:3412',
      LITTLECUPBOARD_ORIGIN: origin,
      LITTLECUPBOARD_STATIC_DIR: staticDirectory,
      LITTLECUPBOARD_DATA_DIR: join(directory, 'data'),
      LITTLECUPBOARD_SECRET_KEY: '42'.repeat(32),
      LITTLECUPBOARD_SETUP_TOKEN: 'update-test-setup',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
server.stdout.on('data', (chunk) => logs.push(chunk.toString()))
server.stderr.on('data', (chunk) => logs.push(chunk.toString()))
let browser
try {
  const deadline = Date.now() + 90000
  while (true) {
    try {
      if ((await fetch(origin + '/api/ready')).ok) break
    } catch {}
    assert.ok(
      Date.now() < deadline,
      `Update fixture did not start: ${logs.join('')}`,
    )
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  browser = await launchBrowser()
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  })
  const setup = await context.request.post(origin + '/api/auth/setup', {
    headers: { Origin: origin, 'X-LittleCupboard-Request': '1' },
    data: {
      setupToken: 'update-test-setup',
      email: 'updates@example.test',
      name: 'Update fixture',
      password: 'Fixture-password-1234',
      householdName: 'Update household',
      timeZone: 'Europe/Helsinki',
    },
  })
  assert.equal(setup.status(), 200, await setup.text())
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(origin)
  await settle(page)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
  assert.equal(
    await page.locator('meta[name="test-release"]').getAttribute('content'),
    'first',
  )
  assert.equal(
    await page.getByRole('complementary', { name: 'App update' }).count(),
    0,
  )
  const other = await context.newPage()
  await other.goto(origin)
  await settle(other)
  await other
    .getByRole('combobox', { name: 'Add a shopping item' })
    .fill('Unsaved search')
  await context.route('**/api/operations', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":"Fixture server busy"}',
    }),
  )
  await context.setOffline(true)
  await page
    .getByRole('combobox', { name: 'Add a shopping item' })
    .fill('Coffee')
  await page.getByRole('option', { name: /Coffee/ }).click()
  await page
    .getByRole('button', { name: 'Check Coffee', exact: true })
    .waitFor()
  const queued = await page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([key]) => key.startsWith('forkbasket:queue:'))
      .some(([, value]) => JSON.parse(value).length > 0),
  )
  assert.ok(queued, 'Offline shopping change must be durable before updating')
  await release('second', false)
  await context.setOffline(false)
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration()).update()
  })
  const notice = page.getByRole('complementary', { name: 'App update' })
  await notice.waitFor()
  await other.getByRole('complementary', { name: 'App update' }).waitFor()
  assert.equal(
    await page.locator('meta[name="test-release"]').getAttribute('content'),
    'first',
    'No forced refresh',
  )
  await mkdir('test-results', { recursive: true })
  await page.screenshot({
    path: 'test-results/update-mobile.png',
    fullPage: true,
  })
  page.on('dialog', (dialog) => dialog.accept())
  await Promise.all([
    page.waitForEvent('framenavigated', {
      predicate: (frame) => frame === page.mainFrame(),
    }),
    notice.getByRole('button', { name: 'Reload app', exact: true }).click(),
  ])
  await page.waitForLoadState('load')
  await settle(page)
  await page.waitForFunction(
    () =>
      document.querySelector('meta[name="test-release"]')?.content === 'second',
  )
  await page
    .getByRole('button', { name: 'Check Coffee', exact: true })
    .waitFor()
  assert.ok(
    await page.evaluate(() =>
      Object.entries(localStorage)
        .filter(([key]) => key.startsWith('forkbasket:queue:'))
        .some(([, value]) => JSON.parse(value).length > 0),
    ),
    'Pending shopping survives the version reload',
  )
  await context.unroute('**/api/operations')
  await page.waitForFunction(async () =>
    (await (await fetch('/api/state')).json()).state.items.some(
      (item) => item.id === 'coffee',
    ),
  )
  assert.equal(
    await other.locator('meta[name="test-release"]').getAttribute('content'),
    'first',
    'Other open tabs keep their drafts',
  )
  assert.equal(
    await other
      .getByRole('combobox', { name: 'Add a shopping item' })
      .inputValue(),
    'Unsaved search',
  )
  assert.equal(
    await other.evaluate(async (path) => (await fetch(path)).text(), oldAsset),
    'previous release asset',
    'Previous lazy assets remain available',
  )
  await other.setViewportSize({ width: 1440, height: 1000 })
  await other.screenshot({
    path: 'test-results/update-desktop.png',
    fullPage: true,
  })
  other.once('dialog', (dialog) => dialog.dismiss())
  await other
    .getByRole('complementary', { name: 'App update' })
    .getByRole('button', { name: 'Reload app', exact: true })
    .click()
  assert.equal(
    await other.locator('meta[name="test-release"]').getAttribute('content'),
    'first',
    'Canceling the draft warning keeps the current tab intact',
  )
  const caches = await page.evaluate(() => window.caches.keys())
  assert.ok(caches.includes('littlecupboard-shell-fixture-first'))
  assert.ok(caches.includes('littlecupboard-shell-fixture-second'))
  const privateCached = await page.evaluate(async () => {
    for (const key of await window.caches.keys())
      for (const request of await (await window.caches.open(key)).keys())
        if (new URL(request.url).pathname.startsWith('/api/')) return true
    return false
  })
  assert.equal(privateCached, false)
  await context.setOffline(true)
  await page.reload()
  await settle(page)
  await page
    .getByRole('button', { name: 'Check Coffee', exact: true })
    .waitFor()
  assert.equal(
    await page.locator('meta[name="test-release"]').getAttribute('content'),
    'second',
  )
  assert.deepEqual(errors, [])
  console.log(
    'Real service-worker update, explicit reload, other-tab drafts/lazy assets, durable offline shopping, private-cache exclusion and new offline shell passed.',
  )
} finally {
  await browser?.close()
  server.kill('SIGTERM')
  await new Promise((resolve) =>
    server.exitCode !== null ? resolve() : server.once('exit', resolve),
  )
  await rm(directory, { recursive: true, force: true })
}
