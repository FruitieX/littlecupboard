import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchBrowser, settle } from './browser.mjs'

const data = await mkdtemp(join(tmpdir(), 'forkbasket-ui-'))
const frontendUrl = 'http://127.0.0.1:3300'
const production = process.env.FORKBASKET_TEST_PRODUCTION === '1'
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
    headers: { 'X-ForkBasket-Request': '1', Origin: frontendUrl },
    data: body,
  })
  assert.ok(response.ok(), `${path}: ${await response.text()}`)
  return response.json()
}
let browser
let owner
let provider
try {
  start('cargo', ['run', '--manifest-path', 'backend/Cargo.toml'], {
    FORKBASKET_BIND: production ? '127.0.0.1:3300' : '127.0.0.1:3301',
    ...(production ? { FORKBASKET_STATIC_DIR: 'dist/client' } : {}),
    FORKBASKET_ORIGIN: frontendUrl,
    FORKBASKET_DATA_DIR: data,
    FORKBASKET_SETUP_TOKEN: 'ui-only-bootstrap-token',
  })
  await wait(`${backendUrl}/api/ready`)
  if (!production)
    start(
      process.execPath,
      ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'],
      { FORKBASKET_PORT: '3300', FORKBASKET_API_URL: backendUrl },
    )
  await wait(frontendUrl)
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
  await wife.getByRole('button', { name: 'Check Avocado', exact: true }).click()
  await owner
    .getByRole('button', { name: 'Restore Avocado', exact: true })
    .waitFor()
  await owner
    .getByRole('button', { name: 'Restore Avocado', exact: true })
    .click()
  await wife
    .getByRole('button', { name: 'Check Avocado', exact: true })
    .waitFor()
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
  await owner
    .getByRole('button', { name: 'Save to our recipe book', exact: true })
    .click()
  await owner
    .getByRole('button', { name: 'Open Family test bowl', exact: true })
    .waitFor()
  await owner.reload()
  await settle(owner)
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

  provider = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const input = JSON.parse(body || '{}')
    const content =
      input.messages?.[0]?.role === 'user'
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
  await owner.goto(frontendUrl + '/settings')
  await settle(owner)
  await owner
    .getByLabel('Enable the household assistant', { exact: true })
    .check()
  await owner
    .getByLabel('Provider base URL', { exact: true })
    .fill('http://127.0.0.1:' + provider.address().port + '/v1')
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
  await owner
    .getByRole('button', { name: 'Save selected suggestions', exact: true })
    .click()
  await owner.getByRole('button', { name: 'Close dialog', exact: true }).click()
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
  for (const width of [320, 390, 768, 1440]) {
    await owner.setViewportSize({ width, height: 900 })
    for (const path of ['/', '/week', '/recipes', '/settings']) {
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

  if (process.env.FORKBASKET_CAPTURE === '1') {
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
