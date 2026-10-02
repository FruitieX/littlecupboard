import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchBrowser, settle } from './browser.mjs'

const data = await mkdtemp(join(tmpdir(), 'littlecupboard-ui-'))
const frontendUrl = 'http://127.0.0.1:3300'
const production = process.env.LITTLECUPBOARD_TEST_PRODUCTION === '1'
const backendUrl = production ? frontendUrl : 'http://127.0.0.1:3301'
const processes = []
const logs = []
function start(command, args, env) {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (data) => logs.push(data.toString()))
  child.stderr.on('data', (data) => logs.push(data.toString()))
  processes.push(child)
  return child
}
async function wait(url) {
  const end = Date.now() + 90000
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Server did not become ready: ${url}\n${logs.join('')}`)
}
async function hold(page, button) {
  await button.scrollIntoViewIfNeeded()
  const box = await button.boundingBox()
  const touch = await page.context().newCDPSession(page)
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
  })
  await page.getByRole('dialog').waitFor()
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
  await touch.detach()
}
async function dismissRecovery(page) {
  await page
    .getByRole('button', { name: 'I saved my code', exact: true })
    .click()
  await settle(page)
}
async function request(page, path, body, method = 'POST') {
  const response = await page.request.fetch(`${frontendUrl}/api${path}`, {
    method,
    headers: { 'X-LittleCupboard-Request': '1', Origin: frontendUrl },
    data: body,
  })
  assert.ok(response.ok(), `${path}: ${await response.text()}`)
  return response.json()
}
async function eventually(check) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Background operation did not complete in time')
}
let browser
let owner
let provider
try {
  start('cargo', ['run', '--manifest-path', 'backend/Cargo.toml'], {
    LITTLECUPBOARD_BIND: production ? '127.0.0.1:3300' : '127.0.0.1:3301',
    ...(production ? { LITTLECUPBOARD_STATIC_DIR: 'dist/client' } : {}),
    LITTLECUPBOARD_ORIGIN: frontendUrl,
    LITTLECUPBOARD_DATA_DIR: data,
    LITTLECUPBOARD_SETUP_TOKEN: 'ui-only-bootstrap-token',
    LITTLECUPBOARD_SQLITE_JOURNAL_MODE: 'DELETE',
  })
  await wait(`${backendUrl}/api/ready`)
  if (!production)
    start(
      process.execPath,
      ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'],
      { LITTLECUPBOARD_PORT: '3300', LITTLECUPBOARD_API_URL: backendUrl },
    )
  await wait(frontendUrl)
  const manifest = await (
    await fetch(`${frontendUrl}/manifest.webmanifest`)
  ).json()
  assert.equal(manifest.name, 'LittleCupboard')
  assert.equal(manifest.short_name, 'LittleCupboard')
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.start_url, '/')
  for (const edge of [192, 512]) {
    const icon = await fetch(`${frontendUrl}/icon-${edge}.png`)
    assert.ok(icon.ok)
    const png = Buffer.from(await icon.arrayBuffer())
    assert.equal(png.readUInt32BE(16), edge)
    assert.equal(png.readUInt32BE(20), edge)
  }
  if (production) assert.ok((await fetch(`${frontendUrl}/sw.js`)).ok)
  browser = await launchBrowser()
  const options = {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  }
  const ownerContext = await browser.newContext(options)
  const wifeContext = await browser.newContext(options)
  owner = await ownerContext.newPage()
  const wife = await wifeContext.newPage()
  const errors = []
  for (const page of [owner, wife])
    page.on('pageerror', (error) => errors.push(error.message))
  await owner.goto(frontendUrl)
  await owner
    .getByLabel('Setup token', { exact: true })
    .fill('ui-only-bootstrap-token')
  await owner.getByLabel('Your name', { exact: true }).fill('Rasse')
  await owner.getByLabel('Email', { exact: true }).fill('rasse@example.test')
  await owner
    .getByLabel('Password', { exact: true })
    .fill('a good family passphrase')
  await owner
    .getByRole('button', { name: 'Create our household', exact: true })
    .click()
  await dismissRecovery(owner)
  assert.equal(
    await owner.getByRole('heading', { level: 1 }).innerText(),
    'Shopping list',
  )
  assert.equal(
    await owner.getByRole('button', { name: 'Open family assistant' }).count(),
    0,
  )
  console.log('First-owner setup and hidden unconfigured assistant passed.')
  await owner
    .getByRole('combobox', { name: 'Add a shopping item' })
    .fill('Avoca')
  await owner.getByRole('option', { name: /Avocado/ }).click()
  await owner
    .getByRole('button', { name: 'Check Avocado', exact: true })
    .waitFor()
  await owner.goto(`${frontendUrl}/settings`)
  await settle(owner)
  await owner
    .getByLabel('Invite a family member', { exact: true })
    .fill('wife@example.test')
  await owner
    .getByRole('button', { name: 'Create invitation', exact: true })
    .click()
  const invitation = await owner
    .getByRole('textbox', { name: 'Invitation link', exact: true })
    .inputValue()
  await wife.goto(invitation)
  await wife.getByLabel('Your name', { exact: true }).fill('Anna')
  await wife
    .getByLabel('Password', { exact: true })
    .fill('a different family passphrase')
  await wife
    .getByRole('button', { name: 'Join our household', exact: true })
    .click()
  await dismissRecovery(wife)
  await wife
    .getByRole('button', { name: 'Check Avocado', exact: true })
    .waitFor()
  await owner.goto(frontendUrl)
  await settle(owner)
  for (const name of ['Milk', 'Bananas']) {
    await owner
      .getByRole('combobox', { name: 'Add a shopping item' })
      .fill(name)
    await owner
      .getByRole('option')
      .filter({ hasText: new RegExp(`^${name}`) })
      .first()
      .click()
    await owner
      .getByRole('button', { name: `Check ${name}`, exact: true })
      .waitFor()
  }
  const continuousOrder = await owner
    .locator('.item-grid .tile-check strong')
    .allTextContents()
  // Fruits precede dairy in the initial store, regardless of insertion order.
  assert.ok(
    continuousOrder.indexOf('Bananas') < continuousOrder.indexOf('Milk'),
  )
  assert.equal(await owner.locator('.shopping-main .item-grid').count(), 1)
  await owner.goto(`${frontendUrl}/settings`)
  const grouping = owner.getByRole('checkbox', { name: 'Group by category' })
  assert.equal(await grouping.isChecked(), false)
  await grouping.check()
  await owner.goto(frontendUrl)
  await settle(owner)
  assert.ok((await owner.locator('.shopping-group h2').count()) > 0)
  assert.deepEqual(
    await owner.locator('.item-grid .tile-check strong').allTextContents(),
    continuousOrder,
  )
  await owner.reload()
  await settle(owner)
  assert.ok((await owner.locator('.shopping-group h2').count()) > 0)
  assert.equal(await wife.locator('.shopping-main .item-grid').count(), 1)
  await owner.goto(`${frontendUrl}/settings`)
  await owner.getByRole('checkbox', { name: 'Group by category' }).uncheck()
  await owner.goto(frontendUrl)
  await settle(owner)
  assert.equal(await owner.locator('.shopping-main .item-grid').count(), 1)
  for (const id of ['milk', 'bananas']) {
    await request(owner, '/operations', {
      id: crypto.randomUUID(),
      operation: { type: 'removeItem', id },
    })
    await owner
      .getByRole('button', {
        name: `Check ${id === 'milk' ? 'Milk' : 'Bananas'}`,
        exact: true,
      })
      .waitFor({ state: 'hidden' })
  }
  console.log(
    'Continuous shopping grid defaults, optional persistent category grouping and independent family preferences passed.',
  )
  await wife.getByRole('button', { name: 'Check Avocado', exact: true }).click()
  await owner
    .getByRole('button', { name: 'Restore Avocado', exact: true })
    .waitFor()
  assert.ok(
    (await request(owner, '/state', undefined, 'GET')).state.pantry.avocado,
  )
  await owner
    .getByRole('button', { name: 'Restore Avocado', exact: true })
    .click()
  await wife
    .getByRole('button', { name: 'Check Avocado', exact: true })
    .waitFor()
  assert.equal(
    (await request(wife, '/state', undefined, 'GET')).state.pantry.avocado,
    undefined,
  )
  await hold(
    wife,
    wife.getByRole('button', { name: 'Check Avocado', exact: true }),
  )
  await wife.getByLabel('A little more detail').fill('Ripe · for lunch')
  await wife.getByRole('button', { name: 'Save details', exact: true }).click()
  await owner
    .getByRole('button', { name: 'Check Avocado', exact: true })
    .filter({ hasText: 'Ripe' })
    .waitFor()
  console.log(
    'Independent household sessions, SSE check/restore, and touch editing passed.',
  )
  await owner.goto(`${frontendUrl}/week`)
  await settle(owner)
  await owner.getByRole('button', { name: 'Next week', exact: true }).click()
  await owner
    .getByRole('button', { name: 'Plan Monday lunch', exact: true })
    .click()
  await owner
    .getByRole('dialog')
    .getByRole('button', { name: /^Green goddess pasta/ })
    .click()
  const pasta = wife.getByRole('button', { name: 'Check Pasta', exact: true })
  await pasta.waitFor()
  assert.match(await pasta.innerText(), /400 g[\s\S]*Meal plan/)
  await wife.reload()
  await settle(wife)
  assert.match(await pasta.innerText(), /400 g/)
  await pasta.click()
  await wife
    .getByRole('button', { name: 'Restore Pasta', exact: true })
    .waitFor()
  await wife.reload()
  await settle(wife)
  assert.equal(await pasta.count(), 0)
  console.log(
    'Automatic planned ingredients and durable purchase coverage passed.',
  )
  await wifeContext.setOffline(true)
  await wife
    .getByRole('combobox', { name: 'Add a shopping item' })
    .fill('Coffee')
  await wife.getByRole('option', { name: /Coffee/ }).click()
  await wife
    .getByRole('button', { name: 'Check Coffee', exact: true })
    .waitFor()
  if (production) {
    await wife.evaluate(() => navigator.serviceWorker.ready)
    await wife.reload()
    await settle(wife)
    await wife
      .getByRole('button', { name: 'Check Coffee', exact: true })
      .waitFor()
  }
  await wifeContext.setOffline(false)
  await owner.goto(frontendUrl)
  await settle(owner)
  await owner
    .getByRole('button', { name: 'Check Coffee', exact: true })
    .waitFor()
  console.log('Offline shopping queued and synchronized after reconnection.')

  await owner.goto(frontendUrl)
  await settle(owner)
  await owner.getByRole('button', { name: 'Pantry', exact: true }).click()
  await owner.getByLabel('Pantry item', { exact: true }).fill('Rice')
  await owner.getByLabel('Quantity', { exact: true }).fill('500')
  await owner.getByLabel('Unit', { exact: true }).fill('g')
  await owner
    .getByRole('button', { name: 'Confirm amount', exact: true })
    .click()
  await owner
    .getByRole('dialog')
    .getByText(/500 g · Confirmed/)
    .waitFor()
  await owner.waitForFunction(
    async () =>
      (await (await fetch('/api/state')).json()).state.pantry.rice?.amounts[0]
        ?.quantity === 500,
  )
  await owner
    .getByRole('button', { name: 'Edit Rice in pantry', exact: true })
    .click()
  await owner.getByLabel('Pantry quantity 1', { exact: true }).fill('750')
  await owner
    .getByLabel('Pantry notes', { exact: true })
    .fill('Opened cupboard pack')
  await owner.getByLabel('Pantry use by', { exact: true }).fill('2026-12-31')
  await owner
    .getByRole('button', { name: 'Add another amount', exact: true })
    .click()
  await owner.getByLabel('Pantry quantity 2', { exact: true }).fill('2')
  await owner.getByLabel('Pantry unit 2', { exact: true }).fill('bag')
  await owner
    .getByRole('dialog')
    .screenshot({ path: 'test-results/pantry-edit-mobile.png' })
  await ownerContext.setOffline(true)
  await owner
    .getByRole('button', { name: 'Save pantry entry', exact: true })
    .click()
  await owner
    .getByRole('button', { name: 'Edit Rice in pantry', exact: true })
    .click()
  await owner.getByLabel('Pantry quantity 2', { exact: true }).fill('800')
  await owner
    .getByRole('button', { name: 'Save pantry entry', exact: true })
    .click()
  await ownerContext.setOffline(false)
  await eventually(async () => {
    const pantry = (await request(wife, '/state', undefined, 'GET')).state
      .pantry.rice
    return (
      pantry.note === 'Opened cupboard pack' &&
      pantry.amounts.some((a) => a.unit === 'g' && a.quantity === 800)
    )
  })
  const editedPantry = (await request(wife, '/state', undefined, 'GET')).state
    .pantry.rice
  assert.deepEqual(editedPantry.amounts, [
    { quantity: 2, unit: 'bag' },
    { quantity: 800, unit: 'g' },
  ])
  assert.equal(editedPantry.expiresAt, '2026-12-31')
  assert.equal(editedPantry.confirmed, true)
  assert.equal(await owner.getByText(/Review changes/).count(), 0)
  console.log(
    'Multiple queued pantry edits preserve quantities, units, notes and expiry across devices without timestamp conflicts.',
  )
  const rejectPantryOnce = async (route) => {
    const operation = route.request().postDataJSON()?.operation
    if (
      operation?.type === 'patch' &&
      operation.changes.some((change) => change.collection === 'pantry')
    )
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          message:
            'Someone changed this entry. Review the latest version and try again.',
        }),
      })
    else await route.continue()
  }
  await owner.route('**/api/operations', rejectPantryOnce)
  await owner
    .getByRole('button', { name: 'Remove Rice from pantry', exact: true })
    .click()
  await owner
    .locator('.connection-pill')
    .filter({ hasText: 'Review changes' })
    .first()
    .waitFor({ state: 'attached' })
  await owner.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await owner.unroute('**/api/operations', rejectPantryOnce)
  await owner
    .getByRole('button', { name: /Review changes/ })
    .first()
    .click()
  const review = owner.getByRole('dialog', {
    name: 'A change needs your attention',
  })
  await review.getByText('Remove Rice from pantry', { exact: true }).waitFor()
  await review.screenshot({ path: 'test-results/pantry-retry-mobile.png' })
  await review.getByRole('button', { name: 'Try syncing', exact: true }).click()
  await review
    .getByText('Everything is synced with your household.', { exact: true })
    .waitFor()
  await review
    .getByRole('button', { name: 'Close dialog', exact: true })
    .click()
  await owner
    .getByRole('button', { name: 'Remove Rice from pantry', exact: true })
    .waitFor({ state: 'hidden' })
  await owner.waitForFunction(
    async () => !(await (await fetch('/api/state')).json()).state.pantry.rice,
  )
  await owner.reload()
  await settle(owner)
  await owner.getByRole('button', { name: 'Pantry', exact: true }).click()
  assert.equal(
    await owner
      .getByRole('button', { name: 'Remove Rice from pantry', exact: true })
      .count(),
    0,
  )
  assert.equal(await owner.getByText(/Review changes/).count(), 0)
  assert.equal(
    (await request(wife, '/state', undefined, 'GET')).state.pantry.rice,
    undefined,
  )
  await owner.getByLabel('Pantry item', { exact: true }).fill('Rice')
  await owner.getByLabel('Quantity', { exact: true }).fill('500')
  await owner.getByLabel('Unit', { exact: true }).fill('g')
  await owner
    .getByRole('button', { name: 'Confirm amount', exact: true })
    .click()
  await owner
    .getByRole('dialog')
    .getByText(/500 g · Confirmed/)
    .waitFor()
  await owner.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await owner.goto(frontendUrl + '/recipes')
  await settle(owner)
  await owner.getByRole('button', { name: 'Add recipe', exact: true }).click()
  await owner
    .getByLabel('Recipe name', { exact: true })
    .fill('Family test bowl')
  await owner
    .getByLabel('Ingredient', { exact: true })
    .fill('Special family seasoning')
  await owner
    .getByRole('button', { name: 'Add ingredient', exact: true })
    .click()
  await owner.getByLabel('Ingredient', { exact: true }).fill('Rice')
  await owner.getByLabel('Quantity', { exact: true }).fill('300')
  await owner.getByLabel('Unit', { exact: true }).fill('g')
  await owner
    .getByRole('button', { name: 'Add ingredient', exact: true })
    .click()
  await owner
    .getByLabel('Upload picture', { exact: true })
    .first()
    .setInputFiles('public/images/pasta.jpg')
  await owner.waitForFunction(() =>
    document
      .querySelector('.image-field-preview')
      ?.getAttribute('src')
      ?.startsWith('/api/images/'),
  )
  await owner
    .getByLabel('How to make it', { exact: true })
    .fill('Cook the rice.\nAdd the seasoning and serve.')
  const tagInput = owner.getByRole('combobox', { name: 'Tags', exact: true })
  await tagInput.fill('veg')
  await owner.getByRole('option', { name: 'Vegetarian', exact: true }).click()
  await tagInput.fill('Vegetarian, Lunchbox')
  await owner
    .getByRole('option', { name: 'Create “Lunchbox”', exact: true })
    .click()
  await owner
    .getByRole('button', { name: 'Save to our recipe book', exact: true })
    .click()
  await owner
    .getByRole('button', { name: 'Open Family test bowl', exact: true })
    .waitFor()
  await owner.reload()
  await settle(owner)
  await owner
    .getByRole('button', { name: 'Filter by tag Lunchbox', exact: true })
    .click()
  await owner.waitForFunction(
    () => document.querySelectorAll('.recipe-card').length === 1,
  )
  assert.equal(await owner.locator('.recipe-card').count(), 1)
  await owner
    .getByRole('button', { name: 'Filter by tag Vegetarian', exact: true })
    .click()
  await owner
    .getByRole('button', { name: 'Open Family test bowl', exact: true })
    .waitFor()
  await owner.getByRole('button', { name: 'All recipes', exact: true }).click()
  await owner
    .getByRole('button', { name: 'Open Family test bowl', exact: true })
    .click()
  await owner.getByRole('button', { name: 'Edit recipe', exact: true }).click()
  await owner
    .getByLabel('Recipe name', { exact: true })
    .fill('Family rice bowl')
  await owner
    .getByRole('button', { name: 'Save to our recipe book', exact: true })
    .click()
  await owner
    .getByRole('button', { name: 'Open Family rice bowl', exact: true })
    .waitFor()
  await wife.goto(frontendUrl + '/recipes')
  await settle(wife)
  await wife
    .getByRole('button', { name: 'Open Family rice bowl', exact: true })
    .waitFor()
  await wife
    .getByRole('button', { name: 'Filter by tag Lunchbox', exact: true })
    .click()
  await wife.waitForFunction(
    () => document.querySelectorAll('.recipe-card').length === 1,
  )
  assert.equal(await wife.locator('.recipe-card').count(), 1)
  await wife.getByRole('button', { name: 'All recipes', exact: true }).click()
  console.log(
    'Pantry observations, recipe creation/editing, custom ingredients and private photo persistence passed.',
  )
  await owner.goto(frontendUrl + '/week')
  await settle(owner)
  await owner.getByRole('button', { name: 'Next week', exact: true }).click()
  await owner.getByLabel('Servings for Monday', { exact: true }).fill('6')
  await wife.goto(frontendUrl)
  await settle(wife)
  await wife
    .getByRole('button', { name: 'Check Pasta', exact: true })
    .filter({ hasText: '200 g' })
    .waitFor()
  const mondayCard = owner.locator('.day-card').filter({ hasText: 'MON' })
  await mondayCard
    .getByRole('button', { name: 'Cooked / skipped', exact: true })
    .click()
  await owner
    .getByRole('button', { name: 'Skipped this meal', exact: true })
    .click()
  await mondayCard
    .getByRole('button', { name: 'skipped', exact: true })
    .waitFor()
  await wife
    .getByRole('button', { name: 'Restore Pasta', exact: true })
    .waitFor()
  console.log(
    'Serving changes top up purchased ingredients, and skipped meals release them to estimated pantry.',
  )
  await owner.goto(frontendUrl)
  await settle(owner)
  const snapshot = await request(owner, '/state', undefined, 'GET')
  await request(owner, '/operations', {
    id: crypto.randomUUID(),
    operation: {
      type: 'patch',
      label: 'Many shops fixture',
      changes: Array.from({ length: 80 }, (_, index) => ({
        collection: 'stores',
        key: `shop-${index}`,
        field: null,
        before: null,
        after: {
          id: `shop-${index}`,
          name: `Neighborhood Market ${String(index).padStart(3, '0')}`,
          location: index === 79 ? 'Harbor district' : 'City center',
          order: snapshot.state.groups,
        },
      })),
    },
  })
  await owner.reload()
  await settle(owner)
  const shop = owner.getByRole('combobox', { name: 'Shopping at', exact: true })
  await shop.fill('Harbor')
  await owner.getByRole('option', { name: /Neighborhood Market 079/ }).click()
  assert.equal(await shop.inputValue(), 'Neighborhood Market 079')
  await owner.reload()
  await settle(owner)
  assert.equal(await shop.inputValue(), 'Neighborhood Market 079')
  assert.equal(
    await wife
      .getByRole('combobox', { name: 'Shopping at', exact: true })
      .inputValue(),
    'Our shop',
  )
  console.log(
    'Autocomplete over 80 shops and independent device store selection passed.',
  )

  const iconFixture = await owner.evaluate(
    async (svg) => {
      const image = new Image()
      image.src = 'data:image/svg+xml;base64,' + btoa(svg)
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 512
      canvas.getContext('2d').drawImage(image, 64, 64, 384, 384)
      return canvas.toDataURL('image/png').split(',')[1]
    },
    await readFile('public/images/food/1f34e.svg', 'utf8'),
  )
  const providerRequests = []
  let imageDelay = 0
  let imageFailures = 0
  provider = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const input = JSON.parse(body || '{}')
    providerRequests.push(input)
    if (req.url === '/v1/images/generations') {
      if (imageDelay)
        await new Promise((resolve) => setTimeout(resolve, imageDelay))
      res.setHeader('Content-Type', 'application/json')
      if (imageFailures > 0) {
        imageFailures--
        res.statusCode = 429
        res.end(JSON.stringify({ error: 'Fixture image failure' }))
        return
      }
      res.end(JSON.stringify({ data: [{ b64_json: iconFixture }] }))
      return
    }
    const hasImages = input.messages?.some((message) =>
      Array.isArray(message.content),
    )
    const content = hasImages
      ? JSON.stringify({
          message: 'Recipe transcribed. Review all quantities before saving.',
          shopping: [],
          plan: [],
          recipes: [
            {
              name: 'Imported recipe',
              subtitle:
                '## Notes\n\n**Keep chilled**.\n\n- Serve fresh\n- Stir gently',
              minutes: 10,
              servings: 4,
              tags: ['Imported'],
              ingredients: [
                {
                  name: 'Apples',
                  productId: 'apples',
                  category: null,
                  quantity: 4,
                  unit: 'pc',
                  note: '',
                },
                {
                  name: 'Bergamot powder',
                  productId: null,
                  category: null,
                  quantity: 1,
                  unit: 'g',
                  note: 'Check the original',
                },
              ],
              steps: [
                'Wash the apples.',
                'Stir in **bergamot**.',
                'Serve fresh.',
              ],
            },
          ],
        })
      : input.messages?.[0]?.role === 'user'
        ? 'Connected'
        : JSON.stringify({
            message: 'Pick up a little fruit for lunch.',
            shopping: [
              {
                name: 'Apples',
                productId: 'apples',
                category: null,
                quantity: 4,
                unit: 'pc',
                note: 'Crisp',
              },
            ],
            recipes: [],
            plan: [],
          })
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content } }] }))
  })
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve))
  const promptDefaults = (await request(owner, '/ai/config', undefined, 'GET'))
    .promptDefaults
  let failConfigOnce = true
  const failingSettings = async (route) => {
    if (route.request().method() === 'GET' && failConfigOnce) {
      failConfigOnce = false
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Settings temporarily unavailable.' }),
      })
    } else await route.continue()
  }
  await owner.route('**/api/ai/config', failingSettings)
  await owner.goto(frontendUrl + '/settings')
  await settle(owner)
  await owner
    .getByRole('button', {
      name: 'Retry loading assistant settings',
      exact: true,
    })
    .waitFor()
  assert.equal(
    await owner
      .getByLabel('Item and shop icon instructions', { exact: true })
      .count(),
    0,
  )
  assert.equal(
    await owner
      .getByRole('button', { name: 'Save provider', exact: true })
      .count(),
    0,
  )
  await owner
    .getByRole('button', {
      name: 'Retry loading assistant settings',
      exact: true,
    })
    .click()
  await owner.getByText('Configure AI assistant', { exact: true }).waitFor()
  failConfigOnce = true
  await owner.reload()
  await settle(owner)
  await owner
    .getByRole('button', {
      name: 'Retry loading assistant settings',
      exact: true,
    })
    .waitFor()
  await owner.evaluate(() => window.dispatchEvent(new Event('online')))
  await owner.getByText('Configure AI assistant', { exact: true }).waitFor()
  await owner.unroute('**/api/ai/config', failingSettings)
  await owner.getByText('Configure AI assistant', { exact: true }).click()
  await owner.getByText('Advanced prompts', { exact: true }).click()
  for (const [key, label] of [
    ['assistant', 'Assistant system instructions'],
    ['itemImage', 'Item and shop icon instructions'],
    ['recipeImage', 'Recipe photo instructions'],
  ]) {
    assert.ok(promptDefaults[key].length > 100)
    assert.equal(
      await owner.getByLabel(label, { exact: true }).inputValue(),
      promptDefaults[key],
    )
  }
  await owner.getByText('Advanced prompts', { exact: true }).click()
  console.log(
    'Assistant settings failures recover through Retry/reconnect without exposing blank defaults or Save controls; all prompt fields contain server defaults.',
  )
  await owner
    .getByLabel('Enable the household assistant', { exact: true })
    .check()
  await owner
    .getByLabel('Provider base URL', { exact: true })
    .fill('http://127.0.0.1:' + provider.address().port + '/v1')
  await owner.getByLabel(/^API key/).fill('test-fixture-key')
  await owner.getByLabel('Chat model', { exact: true }).fill('fixture-chat')
  await owner
    .getByRole('button', { name: 'Test connection', exact: true })
    .click()
  await owner
    .getByText('Connected. Your chat model responded successfully.', {
      exact: true,
    })
    .waitFor()
  await owner
    .getByRole('button', { name: 'Save provider', exact: true })
    .click()
  // Existing artwork, including emoji icons, must survive bulk generation.
  const iconState = (await request(owner, '/state', undefined, 'GET')).state
  const { catalog } = await import('../src/lib/data.ts')
  const placeholderArtwork = catalog
    .filter(
      (product) =>
        product.icon === '🛒' && !iconState.productImages[product.id],
    )
    .map((product) => ({
      collection: 'productImages',
      key: product.id,
      field: null,
      before: null,
      after: '/images/pasta.jpg',
    }))
  if (placeholderArtwork.length)
    await request(owner, '/operations', {
      id: crypto.randomUUID(),
      operation: {
        type: 'patch',
        label: 'Existing fixture artwork',
        changes: placeholderArtwork,
      },
    })
  await owner.getByRole('link', { name: 'Manage items', exact: true }).click()
  await owner.getByRole('button', { name: 'Create item', exact: true }).click()
  await owner
    .getByLabel('Item name', { exact: true })
    .fill('Automatic icon fixture')
  await owner.getByRole('button', { name: 'Save item', exact: true }).click()
  await owner.getByRole('dialog').waitFor({ state: 'hidden' })
  const fixtureItem = (
    await request(owner, '/state', undefined, 'GET')
  ).state.customProducts.find(
    (product) => product.name === 'Automatic icon fixture',
  )
  assert.ok(fixtureItem)
  assert.equal(
    (await request(owner, '/ai/item-icons', undefined, 'GET')).queued,
    0,
  )
  await owner.goto(`${frontendUrl}/settings`)
  await settle(owner)
  await owner.getByText('Configure AI assistant', { exact: true }).click()
  await owner
    .getByText('Compatibility & image generation', { exact: true })
    .click()
  await owner.getByLabel('Image model', { exact: true }).fill('gpt-image-2')
  await owner
    .getByLabel('Automatically generate icons for new items', { exact: true })
    .check()
  await owner
    .getByRole('button', { name: 'Save provider', exact: true })
    .click()
  await owner.getByRole('link', { name: 'Manage items', exact: true }).click()
  await owner.getByRole('button', { name: 'Create item', exact: true }).click()
  await owner
    .getByLabel('Item name', { exact: true })
    .fill('New automatic icon fixture')
  await owner.getByRole('button', { name: 'Save item', exact: true }).click()
  await owner.getByRole('dialog').waitFor({ state: 'hidden' })
  await eventually(async () => {
    const snapshot = await request(owner, '/state', undefined, 'GET')
    const product = snapshot.state.customProducts.find(
      (product) => product.name === 'New automatic icon fixture',
    )
    return product && !!snapshot.state.productImages[product.id]
  })
  await owner.goto(`${frontendUrl}/settings`)
  await settle(owner)
  await owner.getByText('Configure AI assistant', { exact: true }).click()
  await owner
    .getByText('Compatibility & image generation', { exact: true })
    .click()
  await owner
    .getByLabel('Automatically generate icons for new items', { exact: true })
    .uncheck()
  await owner
    .getByRole('button', { name: 'Save provider', exact: true })
    .click()
  await owner.reload()
  await settle(owner)
  await owner.getByText('Configure AI assistant', { exact: true }).click()
  await owner
    .getByText('Compatibility & image generation', { exact: true })
    .click()
  assert.equal(
    await owner
      .getByLabel('Automatically generate icons for new items', { exact: true })
      .isChecked(),
    false,
  )
  await owner
    .getByRole('button', { name: 'Generate missing icons', exact: true })
    .click()
  let bulkDialog = owner.getByRole('dialog', {
    name: 'Generate missing item icons?',
  })
  await bulkDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(
    (await request(owner, '/ai/item-icons', undefined, 'GET')).queued,
    0,
  )
  imageFailures = 1
  imageDelay = 300
  await owner
    .getByRole('button', { name: 'Generate missing icons', exact: true })
    .click()
  bulkDialog = owner.getByRole('dialog', {
    name: 'Generate missing item icons?',
  })
  await bulkDialog
    .getByRole('button', { name: 'Generate icons', exact: true })
    .click()
  await owner
    .getByRole('button', { name: 'Retry failed icons', exact: true })
    .waitFor()
  await owner
    .getByRole('button', { name: 'Retry failed icons', exact: true })
    .click()
  await eventually(async () => {
    const result = await request(owner, '/ai/item-icons', undefined, 'GET')
    return (
      result.missing === 0 &&
      result.queued === 0 &&
      result.running === 0 &&
      result.failed === 0
    )
  })
  imageDelay = 0
  const filledIcons = (await request(owner, '/state', undefined, 'GET')).state
  assert.ok(filledIcons.productImages[fixtureItem.id])
  for (const change of placeholderArtwork)
    assert.equal(filledIcons.productImages[change.key], change.after)
  assert.equal(filledIcons.productImages.apples, iconState.productImages.apples)
  await mkdir('test-results', { recursive: true })
  await owner
    .locator('.icon-generation-settings')
    .screenshot({ path: 'test-results/missing-icons-mobile.png' })
  await wife.reload()
  await settle(wife)
  const sharedIcons = (await request(wife, '/state', undefined, 'GET')).state
    .productImages
  assert.equal(
    sharedIcons[fixtureItem.id],
    filledIcons.productImages[fixtureItem.id],
  )
  console.log(
    'Automatic icons, persisted toggle, confirmed bulk generation, retry, private artwork and shared state passed.',
  )
  // Restore the original configuration for the subsequent provider/UI checks.
  await owner.getByLabel('Image model', { exact: true }).fill('')
  await owner
    .getByRole('button', { name: 'Save provider', exact: true })
    .click()
  await owner
    .getByRole('button', { name: 'Open family assistant', exact: true })
    .waitFor()
  await owner
    .getByRole('button', { name: 'Open family assistant', exact: true })
    .click()
  await owner
    .getByLabel('What would help?', { exact: true })
    .fill('Add fruit for lunches')
  await owner
    .getByRole('button', { name: 'Ask our assistant', exact: true })
    .click()
  await owner
    .getByText('Pick up a little fruit for lunch.', { exact: true })
    .waitFor()
  const beforeProposal = await request(owner, '/state', undefined, 'GET')
  assert.ok(!beforeProposal.state.items.some((i) => i.id === 'apples'))
  let rejectProposal = true
  const rejectedSave = async (route) => {
    if (
      rejectProposal &&
      route.request().postDataJSON()?.operation?.type === 'applyProposal'
    ) {
      rejectProposal = false
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Fixture proposal conflict' }),
      })
    } else await route.continue()
  }
  await owner.route('**/api/operations', rejectedSave)
  await owner
    .getByRole('button', { name: 'Save selected suggestions', exact: true })
    .click()
  await owner
    .getByText('Fixture proposal conflict', { exact: true })
    .last()
    .waitFor()
  assert.equal(await owner.getByRole('dialog').isVisible(), true)
  assert.ok(
    !(await request(owner, '/state', undefined, 'GET')).state.items.some(
      (item) => item.id === 'apples',
    ),
  )
  await owner
    .getByRole('button', {
      name: 'Discard and request fresh suggestions',
      exact: true,
    })
    .click()
  await owner.unroute('**/api/operations', rejectedSave)
  await owner
    .getByRole('button', { name: 'Ask our assistant', exact: true })
    .click()
  await owner
    .getByText('Pick up a little fruit for lunch.', { exact: true })
    .waitFor()
  await owner
    .getByRole('button', { name: 'Save selected suggestions', exact: true })
    .click()
  await owner.getByRole('dialog').waitFor({ state: 'hidden' })
  await wife
    .getByRole('button', { name: 'Check Apples', exact: true })
    .waitFor()
  await owner.goto(frontendUrl)
  await settle(owner)
  await owner
    .getByRole('button', { name: 'Check Apples', exact: true })
    .waitFor()
  assert.equal(
    (await request(owner, '/state', undefined, 'GET')).state.items.find(
      (i) => i.id === 'apples',
    ).quantity,
    4,
  )
  console.log(
    'Provider configuration/test, hidden-until-configured assistant and reviewed proposals passed through the UI.',
  )
  await owner.goto(`${frontendUrl}/settings`)
  await settle(owner)
  assert.equal(await owner.locator('.ai-setup').getAttribute('open'), null)
  await owner.getByLabel('Family name', { exact: true }).fill('Test family')
  await owner
    .getByRole('button', { name: 'Save family name', exact: true })
    .click()
  await owner
    .getByRole('button', { name: 'Family name saved', exact: true })
    .waitFor()
  await wife.waitForFunction(
    () =>
      document.querySelector('.household strong')?.textContent ===
      'Test family',
  )
  await owner.getByText('Configure AI assistant', { exact: true }).click()
  await owner
    .getByText('Compatibility & image generation', { exact: true })
    .click()
  await owner.getByLabel('Image model', { exact: true }).fill('gpt-image-2')
  await owner.getByText('Advanced prompts', { exact: true }).click()
  await owner
    .getByLabel('Assistant system instructions', { exact: true })
    .fill(
      'Use clear, concise Markdown recipe notes. Preserve original quantities.',
    )
  await owner
    .getByRole('button', { name: 'Save provider', exact: true })
    .click()
  await owner.getByRole('link', { name: 'Manage stores', exact: true }).click()
  await owner
    .locator('.store-option')
    .filter({ hasText: 'Neighborhood Market 079' })
    .click()
  const shopsBefore = (await request(owner, '/state', undefined, 'GET')).state
    .stores
  const selectedShop = shopsBefore.find(
    (shop) => shop.name === 'Neighborhood Market 079',
  )
  await owner.getByRole('button', { name: 'Edit shop', exact: true }).click()
  await owner
    .getByLabel('Store name', { exact: true })
    .fill('Renamed Neighborhood Market')
  await owner
    .getByRole('button', { name: 'Generate icon', exact: true })
    .click()
  await owner.waitForFunction(() =>
    document
      .querySelector('.image-field-preview')
      ?.getAttribute('src')
      ?.startsWith('/api/images/'),
  )
  await owner.getByRole('button', { name: 'Save shop', exact: true }).click()
  await settle(owner)
  await owner
    .getByRole('heading', {
      name: 'Renamed Neighborhood Market · aisle order',
      exact: true,
    })
    .waitFor()
  const editedShop = (
    await request(owner, '/state', undefined, 'GET')
  ).state.stores.find((shop) => shop.id === selectedShop.id)
  assert.equal(editedShop.name, 'Renamed Neighborhood Market')
  assert.deepEqual(editedShop.order, selectedShop.order)
  assert.ok(editedShop.image.startsWith('/api/images/'))
  await owner
    .getByRole('link', { name: 'Manage item groups', exact: true })
    .click()
  const sourceGroup = (
    await request(owner, '/state', undefined, 'GET')
  ).state.items.find((item) => item.id === 'apples').category
  await owner
    .getByRole('button', { name: `Edit group ${sourceGroup}`, exact: true })
    .click()
  await owner.getByLabel('Group name', { exact: true }).fill('Fresh fruit')
  await owner.getByRole('button', { name: 'Save group', exact: true }).click()
  await settle(owner)
  await owner
    .getByRole('button', { name: 'Edit group Fresh fruit', exact: true })
    .waitFor()
  let grouped = (await request(owner, '/state', undefined, 'GET')).state
  assert.equal(grouped.productGroups.apples, 'Fresh fruit')
  assert.ok(
    grouped.stores.every(
      (shop) =>
        shop.order.includes('Fresh fruit') && !shop.order.includes(sourceGroup),
    ),
  )
  await owner
    .getByRole('button', { name: 'Edit group Fresh fruit', exact: true })
    .click()
  await owner.getByText('Delete this group', { exact: true }).click()
  const targetGroup = grouped.groups.find((group) => group !== 'Fresh fruit')
  await owner
    .getByLabel('Move its items to', { exact: true })
    .selectOption(targetGroup)
  await owner.getByRole('button', { name: 'Delete group', exact: true }).click()
  await owner
    .getByRole('dialog', { name: 'Delete group?' })
    .getByRole('button', { name: 'Delete group', exact: true })
    .click()
  await settle(owner)
  await owner.getByRole('dialog').waitFor({ state: 'hidden' })
  grouped = (await request(owner, '/state', undefined, 'GET')).state
  assert.equal(grouped.productGroups.apples, targetGroup)
  assert.ok(!grouped.groups.includes('Fresh fruit'))
  assert.ok(
    grouped.stores.every(
      (shop) => new Set(shop.order).size === shop.order.length,
    ),
  )
  await owner
    .getByRole('button', { name: 'Open family assistant', exact: true })
    .click()
  await owner
    .getByLabel('Attach recipe images', { exact: true })
    .setInputFiles('public/images/pasta.jpg')
  await owner.locator('.attachment').waitFor()
  assert.equal(
    await owner
      .getByLabel('Take recipe photo', { exact: true })
      .getAttribute('capture'),
    'environment',
  )
  await owner
    .getByLabel('Take recipe photo', { exact: true })
    .setInputFiles('public/images/pasta.jpg')
  await owner.waitForFunction(
    () => document.querySelectorAll('.attachment').length === 2,
  )
  await owner
    .getByRole('button', { name: 'Remove recipe image 2', exact: true })
    .click()
  await owner.evaluate((encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (character) =>
      character.charCodeAt(0),
    )
    const transfer = new DataTransfer()
    transfer.items.add(
      new File([bytes], 'Clipboard recipe.png', { type: 'image/png' }),
    )
    document.querySelector('.assistant-modal form').dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    )
  }, iconFixture)
  await owner.waitForFunction(
    () => document.querySelectorAll('.attachment').length === 2,
  )
  await owner
    .getByLabel('What would help?', { exact: true })
    .fill('Transcribe this recipe and help me create a dish photo.')
  await owner
    .getByRole('button', { name: 'Ask our assistant', exact: true })
    .click()
  await owner
    .getByText('Recipe transcribed. Review all quantities before saving.', {
      exact: true,
    })
    .waitFor()
  assert.ok(
    !(await request(owner, '/state', undefined, 'GET')).state.recipeBook.some(
      (recipe) => recipe.name === 'Imported recipe',
    ),
  )
  const visionRequest = providerRequests.find((request) =>
    request.messages?.some((message) => Array.isArray(message.content)),
  )
  assert.equal(
    visionRequest.messages[1].content.filter(
      (part) => part.type === 'image_url',
    ).length,
    2,
  )
  assert.ok(
    visionRequest.messages[0].content.includes('Use clear, concise Markdown'),
  )
  await owner.locator('.proposal-recipe summary').click()
  assert.equal(
    await owner
      .locator('.proposal-recipe .markdown strong')
      .filter({ hasText: 'Keep chilled' })
      .count(),
    1,
  )
  await owner
    .getByRole('button', { name: 'Generate dish photo', exact: true })
    .click()
  await owner.locator('.proposal-dish-photo').waitFor()
  await owner
    .getByRole('button', { name: 'Generate icon', exact: true })
    .click()
  await owner
    .getByRole('button', { name: 'Regenerate icon', exact: true })
    .waitFor()
  const iconRequest = providerRequests.find(
    (request) => request.background === 'transparent',
  )
  assert.equal(iconRequest.output_format, 'png')
  assert.equal(iconRequest.size, '816x816')
  await mkdir('test-results', { recursive: true })
  await owner.getByRole('dialog').screenshot({
    path: 'test-results/recipe-import-mobile.png',
  })
  await ownerContext.setOffline(true)
  await owner
    .getByRole('button', { name: 'Save selected suggestions', exact: true })
    .click()
  await owner
    .getByRole('button', { name: 'Saving selected suggestions…', exact: true })
    .waitFor()
  assert.equal(await owner.getByRole('dialog').isVisible(), true)
  await ownerContext.setOffline(false)
  await owner.getByRole('dialog').waitFor({ state: 'hidden' })
  const sourceRecipe = (
    await request(owner, '/state', undefined, 'GET')
  ).state.recipeBook.find((recipe) => recipe.name === 'Imported recipe')
  assert.equal(sourceRecipe.sourceImages.length, 2)
  assert.deepEqual(
    sourceRecipe.sourceImages.map((source) => source.name),
    ['pasta.jpg', 'Clipboard recipe.png'],
  )
  for (const source of sourceRecipe.sourceImages) {
    assert.equal(
      (await wife.request.get(frontendUrl + source.url)).status(),
      200,
    )
    assert.equal((await fetch(backendUrl + source.url)).status, 401)
  }
  await owner.goto(`${frontendUrl}/recipes`)
  await settle(owner)
  await owner
    .getByRole('button', { name: 'Open Imported recipe', exact: true })
    .click()
  await owner
    .locator('.detail-content .markdown strong')
    .filter({ hasText: 'Keep chilled' })
    .waitFor()
  assert.equal(
    await owner
      .locator('.detail-content .markdown li')
      .filter({ hasText: 'Serve fresh' })
      .count(),
    1,
  )
  await owner.locator('.recipe-sources summary').click()
  await owner.locator('.recipe-source-grid').scrollIntoViewIfNeeded()
  assert.equal(await owner.locator('.recipe-source img').count(), 2)
  await owner.waitForFunction(() =>
    [...document.querySelectorAll('.recipe-source img')].every(
      (img) => img.complete && img.naturalWidth > 0,
    ),
  )
  for (const width of [320, 390, 1440]) {
    await owner.setViewportSize({ width, height: 844 })
    await owner
      .getByRole('dialog')
      .screenshot({ path: `test-results/recipe-sources-${width}.png` })
    assert.equal(
      await owner.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    )
  }
  await owner.setViewportSize({ width: 390, height: 844 })
  await owner.getByRole('dialog').screenshot({
    path: 'test-results/recipe-markdown-mobile.png',
  })
  await owner.getByRole('button', { name: 'Edit recipe', exact: true }).click()
  const importedTags = owner.getByRole('combobox', {
    name: 'Tags',
    exact: true,
  })
  await importedTags.fill('Imported, lun')
  await importedTags.press('ArrowDown')
  await importedTags.press('Enter')
  assert.equal(await importedTags.inputValue(), 'Imported, Lunchbox, ')
  await owner
    .getByRole('dialog')
    .screenshot({ path: 'test-results/recipe-tags-mobile.png' })
  await owner
    .getByRole('button', { name: 'Save to our recipe book', exact: true })
    .click()
  await owner.reload()
  await settle(owner)
  await owner
    .getByRole('button', { name: 'Filter by tag Imported', exact: true })
    .click()
  await owner
    .getByRole('button', { name: 'Open Imported recipe', exact: true })
    .click()
  await owner.locator('.recipe-sources summary').click()
  assert.equal(await owner.locator('.recipe-source img').count(), 2)
  assert.deepEqual(
    (await request(owner, '/state', undefined, 'GET')).state.recipeBook.find(
      (recipe) => recipe.name === 'Imported recipe',
    ).sourceImages,
    sourceRecipe.sourceImages,
  )
  await owner.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await wife.goto(`${frontendUrl}/settings`)
  await settle(wife)
  assert.equal(
    await wife.getByText('Configure AI assistant', { exact: true }).count(),
    0,
  )
  assert.equal(await wife.getByLabel('Family name', { exact: true }).count(), 0)
  console.log(
    'Vision upload/camera/clipboard, reviewed recipe photos/icons, Markdown, shop/family/group edits and owner-only settings passed.',
  )
  await mkdir('test-results', { recursive: true })
  for (const width of [320, 390, 768, 1020, 1120, 1121, 1240, 1440, 1920]) {
    await owner.setViewportSize({ width, height: 1000 })
    await owner.goto(`${frontendUrl}/settings`)
    await settle(owner)
    if ([390, 1440].includes(width))
      await owner.screenshot({ path: `test-results/settings-${width}.png` })
    await owner.getByText('Configure AI assistant', { exact: true }).click()
    await owner
      .getByText('Compatibility & image generation', { exact: true })
      .click()
    await owner.getByText('Advanced prompts', { exact: true }).click()
    if ([390, 1440].includes(width)) {
      await owner.locator('.ai-provider-card').screenshot({
        path: `test-results/settings-ai-${width}.png`,
      })
    }
    const layout = await owner.evaluate(() => {
      const columns = [
        ...document.querySelector('.settings-layout').children,
      ].map((column) => {
        const { x, y, width } = column.getBoundingClientRect()
        return { x, y, width }
      })
      const overflow = [...document.querySelectorAll('.settings-card')].flatMap(
        (card) => {
          const bounds = card.getBoundingClientRect()
          return [...card.querySelectorAll('input, select, textarea, button')]
            .filter((control) => control.getClientRects().length > 0)
            .filter((control) => {
              const rect = control.getBoundingClientRect()
              return (
                rect.left < bounds.left - 1 || rect.right > bounds.right + 1
              )
            })
            .map(
              (control) =>
                control.getAttribute('aria-label') ||
                control.textContent ||
                control.tagName,
            )
        },
      )
      return {
        columns,
        overflow,
        content: document.documentElement.scrollWidth,
        backupButtons: [
          ...document.querySelector('.backup-actions').children,
        ].map((control) => {
          const rect = control.getBoundingClientRect()
          return {
            x: rect.x,
            right: rect.right,
            y: rect.y,
            center: rect.y + rect.height / 2,
          }
        }),
        householdNameBottom: document
          .querySelector('.household > div > span')
          .getBoundingClientRect().bottom,
        householdSyncTop: document
          .querySelector('.household .connection-pill')
          .getBoundingClientRect().top,
      }
    })
    assert.deepEqual(
      layout.overflow,
      [],
      `Settings controls overflow at ${width}px`,
    )
    assert.ok(
      layout.content <= width,
      `Expanded settings overflow at ${width}px`,
    )
    const [download, cleanup] = layout.backupButtons
    if (Math.abs(download.y - cleanup.y) < 2) {
      assert.ok(
        Math.abs(download.center - cleanup.center) <= 1,
        'Backup actions have aligned centers',
      )
      assert.ok(
        cleanup.x - download.right >= 10,
        'Backup actions have comfortable spacing',
      )
    }
    if (width > 1120)
      assert.ok(
        layout.householdSyncTop >= layout.householdNameBottom + 4,
        'Sync badge has its own spaced row below the name',
      )
    const [stores, preferences] = layout.columns
    if (width > 1120) {
      assert.ok(
        Math.abs(stores.y - preferences.y) < 1,
        'Desktop settings share a row',
      )
      assert.ok(
        preferences.width >= stores.width * 0.9,
        `Settings forms are squeezed at ${width}px: ${JSON.stringify(layout.columns)}`,
      )
    } else {
      assert.ok(preferences.y > stores.y, `Settings stack at ${width}px`)
    }
  }
  console.log(
    'Expanded settings controls fit balanced desktop columns and stacked tablet/mobile layouts.',
  )
  for (const width of [320, 390, 768, 1440]) {
    await owner.setViewportSize({ width, height: 1000 })
    await owner.goto(`${frontendUrl}/settings`)
    await settle(owner)
    await owner.getByText('Configure AI assistant', { exact: true }).click()
    await owner
      .getByLabel('Connection', { exact: true })
      .selectOption('companion')
    assert.equal(
      await owner.getByLabel('Chat model', { exact: true }).inputValue(),
      'gpt-6-luna',
    )
    assert.equal(
      await owner.getByLabel('Reasoning effort', { exact: true }).inputValue(),
      'xhigh',
    )
    assert.equal(
      await owner.getByLabel('Provider base URL', { exact: true }).count(),
      0,
    )
    await owner
      .getByRole('button', { name: 'Create pairing token', exact: true })
      .click()
    const token = owner.getByLabel('Companion pairing token', { exact: true })
    await token.waitFor()
    assert.equal(await token.getAttribute('type'), 'password')
    assert.match(await token.inputValue(), /^[a-f0-9]{64}$/)
    const originalToken = await token.inputValue()
    await owner
      .getByRole('button', { name: 'Revoke companion access', exact: true })
      .click()
    let confirmation = owner.getByRole('dialog', {
      name: 'Revoke companion access?',
    })
    await confirmation.waitFor()
    await confirmation
      .getByRole('button', { name: 'Cancel', exact: true })
      .click()
    assert.equal(
      (await request(owner, '/ai/config', undefined, 'GET')).companion.paired,
      true,
    )
    await owner
      .getByRole('button', { name: 'Replace companion token', exact: true })
      .click()
    confirmation = owner.getByRole('dialog', {
      name: 'Replace companion token?',
    })
    await confirmation.waitFor()
    await owner.keyboard.press('Escape')
    assert.equal(await token.inputValue(), originalToken)
    await owner
      .getByRole('button', { name: 'Revoke companion access', exact: true })
      .click()
    await owner
      .getByRole('dialog', { name: 'Revoke companion access?' })
      .getByRole('button', { name: 'Revoke access', exact: true })
      .click()
    await owner
      .getByText('Companion access revoked.', { exact: true })
      .waitFor()
    assert.equal(await token.count(), 0)
    assert.ok(
      await owner.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    )
  }
  console.log(
    'Companion selection, model/reasoning defaults, masked pairing and revocation passed on mobile/desktop.',
  )
  await owner.setViewportSize({ width: 390, height: 844 })
  await owner.goto(`${frontendUrl}/settings`)
  await settle(owner)
  const disconnect = owner.getByRole('button', {
    name: 'Disconnect and remove credentials',
    exact: true,
  })
  assert.equal(
    await disconnect.isVisible(),
    false,
    'Credential deletion is hidden inside collapsed AI setup',
  )
  await owner.getByText('Configure AI assistant', { exact: true }).click()
  const savedProvider = await request(owner, '/ai/config', undefined, 'GET')
  const beforeRemoval = (await request(owner, '/state', undefined, 'GET')).state
  await disconnect.click()
  let confirmation = owner.getByRole('dialog', {
    name: 'Disconnect AI assistant?',
  })
  await confirmation.waitFor()
  assert.equal(
    (await request(owner, '/ai/config', undefined, 'GET')).hasKey,
    savedProvider.hasKey,
    'Opening confirmation does not remove credentials',
  )
  await confirmation
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  assert.equal(
    (await request(owner, '/ai/config', undefined, 'GET')).hasKey,
    savedProvider.hasKey,
    'Cancel preserves credentials',
  )
  assert.deepEqual(
    (await request(owner, '/ai/config', undefined, 'GET')).config,
    savedProvider.config,
  )
  await disconnect.click()
  await owner.keyboard.press('Escape')
  assert.equal(
    (await request(owner, '/ai/config', undefined, 'GET')).hasKey,
    savedProvider.hasKey,
    'Escape preserves credentials',
  )
  await disconnect.click()
  confirmation = owner.getByRole('dialog', { name: 'Disconnect AI assistant?' })
  await confirmation.screenshot({
    path: 'test-results/ai-disconnect-confirmation-mobile.png',
  })
  await confirmation
    .getByRole('button', {
      name: 'Disconnect and delete credentials',
      exact: true,
    })
    .click()
  await owner
    .getByText('Provider configuration and credentials removed.', {
      exact: true,
    })
    .waitFor()
  assert.equal(
    (await request(owner, '/ai/config', undefined, 'GET')).hasKey,
    false,
  )
  assert.equal(
    (await request(owner, '/ai/config', undefined, 'GET')).companion.paired,
    false,
  )
  assert.equal(
    (await request(owner, '/auth/me', undefined, 'GET')).aiEnabled,
    false,
  )
  assert.deepEqual(
    (await request(owner, '/state', undefined, 'GET')).state,
    beforeRemoval,
    'Deleting AI credentials does not change household data',
  )
  await owner.goto(`${frontendUrl}/recipes`)
  await settle(owner)
  await owner
    .getByRole('button', { name: 'Open Imported recipe', exact: true })
    .waitFor()
  console.log(
    'Credential deletion is collapsed, requires explicit confirmation, and preserves recipes; cancel and Escape keep the connection.',
  )
  await owner.goto(`${frontendUrl}/settings`)
  await settle(owner)
  await owner.getByRole('link', { name: 'Manage items', exact: true }).click()
  await owner.getByLabel('Search managed items', { exact: true }).fill('apples')
  await owner
    .getByRole('button', { name: 'Edit catalog item Apples', exact: true })
    .click()
  await owner.getByLabel('Item name', { exact: true }).fill('Eating apples')
  await owner
    .getByLabel('Search aliases', { exact: true })
    .fill('crunchy fruit')
  await owner.getByRole('button', { name: 'Save item', exact: true }).click()
  await owner
    .getByRole('button', {
      name: 'Edit catalog item Eating apples',
      exact: true,
    })
    .waitFor()
  await owner.waitForFunction(
    async () =>
      (await (await fetch('/api/state')).json()).state.productDetails.apples
        ?.name === 'Eating apples',
  )
  await owner
    .getByRole('button', {
      name: 'Edit catalog item Eating apples',
      exact: true,
    })
    .click()
  await owner.getByText('Archive or delete item', { exact: true }).click()
  await owner.getByRole('button', { name: 'Archive item', exact: true }).click()
  await owner
    .getByRole('dialog', { name: 'Archive item?' })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  assert.ok(
    !(
      await request(owner, '/state', undefined, 'GET')
    ).state.archivedProductIds.includes('apples'),
  )
  await owner.getByRole('button', { name: 'Archive item', exact: true }).click()
  await owner
    .getByRole('dialog', { name: 'Archive item?' })
    .getByRole('button', { name: 'Archive item', exact: true })
    .click()
  await owner.getByLabel('Show archived items', { exact: true }).check()
  await owner
    .getByRole('button', {
      name: 'Edit catalog item Eating apples',
      exact: true,
    })
    .click()
  await owner.getByText('Restore or delete item', { exact: true }).click()
  await owner.getByRole('button', { name: 'Restore item', exact: true }).click()
  await owner.getByLabel('Show archived items', { exact: true }).uncheck()
  await owner.getByRole('button', { name: 'Create item', exact: true }).click()
  await owner
    .getByLabel('Item name', { exact: true })
    .fill('Settings test item')
  await owner.getByRole('button', { name: 'Save item', exact: true }).click()
  await owner
    .getByLabel('Search managed items', { exact: true })
    .fill('Settings test item')
  await owner
    .getByRole('button', {
      name: 'Edit catalog item Settings test item',
      exact: true,
    })
    .click()
  await owner.getByText('Archive or delete item', { exact: true }).click()
  await owner
    .getByRole('button', { name: 'Delete item permanently', exact: true })
    .click()
  await owner
    .getByRole('dialog', { name: 'Delete item permanently?' })
    .getByRole('button', { name: 'Delete permanently', exact: true })
    .click()
  await owner
    .getByRole('button', {
      name: 'Edit catalog item Settings test item',
      exact: true,
    })
    .waitFor({ state: 'hidden' })
  await owner.getByRole('link', { name: 'Manage recipes', exact: true }).click()
  await owner
    .getByLabel('Search managed recipes', { exact: true })
    .fill('Imported recipe')
  await owner
    .getByRole('button', {
      name: 'Edit saved recipe Imported recipe',
      exact: true,
    })
    .click()
  await owner
    .getByLabel('Recipe name', { exact: true })
    .fill('Imported family recipe')
  await owner
    .getByRole('button', { name: 'Save to our recipe book', exact: true })
    .click()
  await owner
    .getByLabel('Search managed recipes', { exact: true })
    .fill('Imported family recipe')
  await owner
    .getByRole('button', {
      name: 'Delete saved recipe Imported family recipe',
      exact: true,
    })
    .click()
  await owner
    .getByRole('dialog', { name: 'Delete recipe?' })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  const recipeState = (await request(owner, '/state', undefined, 'GET')).state
  const imported = recipeState.recipeBook.find(
    (entry) => entry.name === 'Imported family recipe',
  )
  assert.ok(imported)
  const plannedDay =
    Object.keys(recipeState.plan)[0] ?? new Date().toISOString().slice(0, 10)
  await request(owner, '/operations', {
    id: crypto.randomUUID(),
    operation: {
      type: 'patch',
      label: 'Plan managed recipe',
      changes: [
        {
          collection: 'plan',
          key: plannedDay,
          field: null,
          before: recipeState.plan[plannedDay] ?? null,
          after: imported.id,
        },
      ],
    },
  })
  await owner
    .getByRole('button', {
      name: 'Delete saved recipe Imported family recipe',
      exact: true,
    })
    .click()
  await owner
    .getByRole('dialog', { name: 'Delete recipe?' })
    .getByRole('button', { name: 'Delete recipe', exact: true })
    .click()
  await owner.waitForFunction(
    async (id) =>
      !(await (await fetch('/api/state')).json()).state.recipeBook.some(
        (entry) => entry.id === id,
      ),
    imported.id,
  )
  const managed = (await request(owner, '/state', undefined, 'GET')).state
  assert.ok(!Object.values(managed.plan).includes(imported.id))
  assert.ok(
    !managed.customProducts.some(
      (entry) => entry.name === 'Settings test item',
    ),
  )
  await owner.getByRole('link', { name: 'Manage stores', exact: true }).click()
  await owner.getByRole('button', { name: 'Add store', exact: true }).click()
  await owner.getByLabel('Store name', { exact: true }).fill('Temporary shop')
  await owner
    .getByRole('dialog')
    .getByRole('button', { name: 'Add store', exact: true })
    .click()
  await owner
    .getByRole('button', { name: 'Remove Temporary shop', exact: true })
    .click()
  await owner
    .getByRole('dialog', { name: 'Remove shop?' })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  await owner
    .getByRole('button', { name: 'Remove Temporary shop', exact: true })
    .click()
  await owner
    .getByRole('dialog', { name: 'Remove shop?' })
    .getByRole('button', { name: 'Remove shop', exact: true })
    .click()
  await owner.waitForFunction(
    async () =>
      !(await (await fetch('/api/state')).json()).state.stores.some(
        (entry) => entry.name === 'Temporary shop',
      ),
  )
  assert.equal(await owner.getByText(/Review changes/).count(), 0)
  await owner.getByRole('link', { name: 'Manage items', exact: true }).click()
  await owner.getByLabel('Search managed items', { exact: true }).fill('apples')
  await owner
    .locator('.settings-card')
    .filter({ hasText: 'Search items' })
    .screenshot({ path: 'test-results/settings-management-mobile.png' })
  console.log(
    'Settings item edits/archive/restore/delete, recipe editing and planned deletion, and confirmed shop removal passed without sync conflicts.',
  )
  await owner
    .getByRole('button', {
      name: 'Edit catalog item Eating apples',
      exact: true,
    })
    .click()
  await owner
    .getByRole('checkbox', { name: 'Set consumption rate', exact: true })
    .check()
  await owner.getByLabel('Consumption quantity', { exact: true }).fill('6')
  await owner.getByLabel('Consumption unit', { exact: true }).fill('pc')
  await owner.getByLabel('Consumption period (days)', { exact: true }).fill('7')
  for (const width of [320, 390, 1440]) {
    await owner.setViewportSize({ width, height: 900 })
    const bounds = await owner
      .locator('.consumption-fields')
      .evaluate((field) => {
        const rect = field.getBoundingClientRect()
        return [...field.querySelectorAll('input')]
          .filter((input) => input.getClientRects().length)
          .every((input) => {
            const control = input.getBoundingClientRect()
            return control.left >= rect.left && control.right <= rect.right
          })
      })
    assert.ok(bounds, `Consumption controls fit at ${width}px`)
    await owner
      .getByRole('dialog')
      .screenshot({ path: `test-results/consumption-${width}.png` })
  }
  await owner.getByRole('button', { name: 'Save item', exact: true }).click()
  await eventually(
    async () =>
      !!(await request(wife, '/state', undefined, 'GET')).state.consumptionRates
        .apples,
  )
  assert.deepEqual(
    (await request(wife, '/state', undefined, 'GET')).state.consumptionRates
      .apples,
    { quantity: 6, unit: 'pc', days: 7 },
  )
  await owner.reload()
  await settle(owner)
  await owner
    .getByLabel('Search managed items', { exact: true })
    .fill('Eating apples')
  await owner
    .getByRole('button', {
      name: 'Edit catalog item Eating apples',
      exact: true,
    })
    .click()
  assert.equal(
    await owner
      .getByLabel('Consumption quantity', { exact: true })
      .inputValue(),
    '6',
  )
  await owner
    .getByRole('checkbox', { name: 'Set consumption rate', exact: true })
    .uncheck()
  await owner.getByRole('button', { name: 'Save item', exact: true }).click()
  // Start a fresh purchase quantity; a non-accumulating add preserves an existing active tile.
  await request(owner, '/operations', {
    id: crypto.randomUUID(),
    operation: { type: 'removeItem', id: 'apples' },
  })
  const dated = []
  for (const days of [21, 14, 7]) {
    await request(owner, '/operations', {
      id: crypto.randomUUID(),
      operation: {
        type: 'addItem',
        productId: 'apples',
        quantity: 6,
        unit: 'pc',
        note: '',
        accumulate: false,
      },
    })
    const bought = await request(owner, '/operations', {
      id: crypto.randomUUID(),
      operation: { type: 'checkItem', id: 'apples', checked: true },
    })
    dated.push([
      new Date(Date.now() - days * 86400000).toISOString(),
      bought.eventId,
    ])
  }
  // Only this disposable test database is changed; production history is untouched.
  execFileSync('python3', [
    '-c',
    'import sqlite3,json,sys; conn=sqlite3.connect(sys.argv[1]); conn.executemany("UPDATE events SET at=? WHERE id=?",json.loads(sys.argv[2])); conn.commit()',
    join(data, 'forkbasket.sqlite3'),
    JSON.stringify(dated),
  ])
  await owner.reload()
  await settle(owner)
  await owner
    .getByLabel('Search managed items', { exact: true })
    .fill('Eating apples')
  await owner
    .getByRole('button', {
      name: 'Edit catalog item Eating apples',
      exact: true,
    })
    .click()
  await owner
    .getByRole('button', { name: 'Use estimated rate', exact: true })
    .waitFor()
  assert.equal(
    await owner
      .getByRole('checkbox', { name: 'Set consumption rate', exact: true })
      .isChecked(),
    false,
  )
  assert.ok(
    !(await request(owner, '/state', undefined, 'GET')).state.consumptionRates
      .apples,
  )
  await owner
    .getByRole('button', { name: 'Use estimated rate', exact: true })
    .click()
  await owner.getByRole('button', { name: 'Save item', exact: true }).click()
  await eventually(
    async () =>
      (await request(wife, '/state', undefined, 'GET')).state.consumptionRates
        .apples?.days === 7,
  )
  assert.deepEqual(
    (await request(wife, '/state', undefined, 'GET')).state.consumptionRates
      .apples,
    { quantity: 6, unit: 'pc', days: 7 },
  )
  console.log(
    'Consumption settings persist across reload/devices; learned quantities stay estimates until explicitly accepted.',
  )
  for (const width of [320, 390, 768, 1440]) {
    await owner.setViewportSize({ width, height: 900 })
    for (const path of [
      '/',
      '/week',
      '/recipes',
      '/settings',
      '/settings/stores',
      '/settings/groups',
      '/settings/items',
      '/settings/recipes',
    ]) {
      await owner.goto(`${frontendUrl}${path}`)
      await settle(owner)
      const size = await owner.evaluate(() => ({
        content: document.documentElement.scrollWidth,
        viewport: innerWidth,
      }))
      assert.ok(
        size.content <= size.viewport,
        `${path} overflows at ${width}px: ${JSON.stringify(size)}`,
      )
      assert.equal(await owner.locator('h1').count(), 1)
      if (path === '/week') {
        await owner.getByRole('button', { name: 'Suggest lunches' }).click()
        const dialog = owner.getByRole('dialog')
        await dialog.locator('.plan-suggestions strong').first().waitFor()
        const meals = await dialog
          .locator('.plan-suggestions > div')
          .evaluateAll((rows) =>
            rows.map((row) => {
              const title = row.querySelector('strong')
              const reason = row.querySelector('small')
              const bounds = (element) => {
                const rect = element.getBoundingClientRect()
                return {
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  bottom: rect.bottom,
                }
              }
              return {
                row: bounds(row),
                title: bounds(title),
                reason: bounds(reason),
                fontSize: parseFloat(getComputedStyle(title).fontSize),
                fits: title.scrollWidth <= title.clientWidth,
              }
            }),
          )
        assert.equal(meals.length, 7)
        for (const meal of meals) {
          assert.ok(
            meal.title.width >= meal.row.width - 104,
            `Meal title squeezed at ${width}px`,
          )
          assert.ok(
            meal.reason.y >= meal.title.bottom,
            `Meal explanation crowds title at ${width}px`,
          )
          assert.ok(
            meal.fontSize >= 14 && meal.fits,
            `Meal title unreadable at ${width}px`,
          )
        }
        await mkdir('test-results', { recursive: true })
        await owner.screenshot({
          path: `test-results/suggest-lunches-${width}.png`,
        })
        await dialog
          .getByRole('button', { name: 'Close dialog', exact: true })
          .click()
      }
    }
  }
  assert.deepEqual(errors, [], 'Browser runtime errors')
  await mkdir('test-results', { recursive: true })
  await owner.setViewportSize({ width: 390, height: 844 })
  await owner.goto(frontendUrl)
  await settle(owner)
  await owner.screenshot({
    path: 'test-results/shopping-shared-mobile.png',
    fullPage: true,
  })

  if (process.env.LITTLECUPBOARD_CAPTURE === '1') {
    await mkdir('mockups', { recursive: true })
    const snapshot = await request(owner, '/state', undefined, 'GET')
    const now = new Date()
    const monday = new Date(now)
    monday.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7))
    const date = (offset) => {
      const day = new Date(monday)
      day.setUTCDate(day.getUTCDate() + offset)
      return day.toISOString().slice(0, 10)
    }
    const changes = snapshot.state.stores
      .filter((store) => store.id !== 'our-store')
      .map((store) => ({
        collection: 'stores',
        key: store.id,
        field: null,
        before: store,
        after: null,
      }))
    for (const [id, name, location] of [
      ['prisma', 'Prisma', 'Our weekly shop'],
      ['lidl', 'Lidl', 'On the way home'],
    ])
      changes.push({
        collection: 'stores',
        key: id,
        field: null,
        before: null,
        after: { id, name, location, order: snapshot.state.groups },
      })
    for (const [offset, recipe] of [
      [0, 'salmon-bowl'],
      [1, 'tomato-soup'],
      [2, 'green-pasta'],
      [3, 'green-pasta'],
      [4, 'tomato-soup'],
      [5, 'salmon-bowl'],
    ]) {
      const day = date(offset)
      if (snapshot.state.recipeBook.some((r) => r.id === recipe))
        changes.push({
          collection: 'plan',
          key: day,
          field: null,
          before: snapshot.state.plan[day] ?? null,
          after: recipe,
        })
    }
    await request(owner, '/operations', {
      id: crypto.randomUUID(),
      operation: { type: 'patch', label: 'Screenshot fixture', changes },
    })
    for (const [product, qty, unit, note] of [
      ['bananas', 6, 'pc', 'A few ripe, a few green'],
      ['oat-milk', 2, 'L', 'Barista'],
      ['eggs', 12, 'pc', 'Free range'],
      ['sourdough-bread', 1, 'loaf', 'Sliced'],
    ])
      await request(owner, '/operations', {
        id: crypto.randomUUID(),
        operation: {
          type: 'addItem',
          productId: product,
          quantity: qty,
          unit,
          note,
          accumulate: false,
        },
      })
    await owner.setViewportSize({ width: 390, height: 844 })
    for (const [name, path] of [
      ['shopping', '/'],
      ['week', '/week'],
      ['recipes', '/recipes'],
      ['settings', '/settings'],
    ]) {
      await owner.goto(frontendUrl + path)
      await settle(owner)
      await owner.evaluate(() =>
        window.scrollTo({ top: 0, behavior: 'instant' }),
      )
      await owner.screenshot({ path: 'mockups/' + name + '-mobile.png' })
      await owner.screenshot({
        path: 'mockups/' + name + '-mobile-full.png',
        fullPage: true,
      })
    }
    await owner.goto(frontendUrl + '/recipes')
    await settle(owner)
    await owner
      .getByRole('button', { name: 'Open Green goddess pasta', exact: true })
      .click()
    await owner.screenshot({ path: 'mockups/recipe-detail-mobile.png' })
    await owner
      .getByRole('button', { name: 'Close dialog', exact: true })
      .click()
    await owner.goto(frontendUrl)
    await settle(owner)
    await owner.getByRole('combobox', { name: 'Shopping at' }).fill('Pr')
    await owner.screenshot({ path: 'mockups/shop-picker-mobile.png' })
    await owner.getByRole('combobox', { name: 'Shopping at' }).press('Escape')
    await owner.getByRole('button', { name: 'Pantry', exact: true }).click()
    await owner.screenshot({ path: 'mockups/pantry-mobile.png' })
    await owner
      .getByRole('button', { name: 'Close dialog', exact: true })
      .click()
    await owner.setViewportSize({ width: 1440, height: 1100 })
    await owner.goto(frontendUrl)
    await settle(owner)
    await owner.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await owner.screenshot({
      path: 'mockups/shopping-desktop.png',
      fullPage: true,
    })
    console.log('Refreshed production screenshots in mockups/.')
  }
  console.log(
    'Production UI foundation checks passed, including responsive layouts.',
  )
} catch (error) {
  await mkdir('test-results', { recursive: true })
  if (owner)
    await owner
      .screenshot({
        path: 'test-results/production-failure.png',
        fullPage: true,
      })
      .catch(() => {})
  throw error
} finally {
  provider?.close()
  await browser?.close()
  for (const child of processes.reverse()) child.kill('SIGTERM')
  await Promise.all(
    processes.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null) resolve()
          else {
            child.once('exit', resolve)
            setTimeout(() => {
              child.kill('SIGKILL')
              resolve()
            }, 2000)
          }
        }),
    ),
  )
  await rm(data, { recursive: true, force: true })
}
