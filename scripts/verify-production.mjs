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
async function replaceNumber(field, value) {
  await field.focus()
  await field.press('ControlOrMeta+A')
  await field.press('Backspace')
  assert.equal(
    await field.inputValue(),
    '',
    'Backspace must leave an empty numeric draft',
  )
  await field.pressSequentially(value)
  assert.equal(
    await field.inputValue(),
    value,
    'Typing must not prefix a forced zero',
  )
}
function cupboardSearch(page) {
  return page.getByRole('combobox', { name: 'Add something we have' })
}
async function stockMenu(page, name, action) {
  await page
    .getByRole('button', { name: `More for ${name}`, exact: true })
    .click()
  await page.getByRole('menuitem', { name: action, exact: true }).click()
}
/** Adds an item from the cupboard search, then confirms its amount. */
async function addToCupboard(page, name, quantity, unit) {
  await page.goto(`${frontendUrl}/cupboard`)
  await settle(page)
  await cupboardSearch(page).fill(name)
  await cupboardSearch(page).press('Enter')
  await page
    .getByRole('button', { name: `More for ${name}`, exact: true })
    .waitFor()
  await stockMenu(page, name, 'Edit amounts & use-by')
  await replaceNumber(
    page.getByLabel('Pantry quantity 1', { exact: true }),
    quantity,
  )
  await page.getByLabel('Pantry unit 1', { exact: true }).fill(unit)
  await page
    .getByRole('button', { name: 'Save pantry entry', exact: true })
    .click()
}
async function openStockRow(page, name) {
  const row = page.locator('.stock-row').filter({
    has: page.locator('.stock-text strong', {
      hasText: new RegExp(`^${name}$`),
    }),
  })
  const toggle = row.locator('.stock-row-main')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true')
    await toggle.click()
  return row
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
// Chat content is a string, or parts with the text first when photos are attached.
const itemText = (content) =>
  typeof content === 'string' ? content : content[0].text
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
  const shoppingQuantity = wife.getByLabel('Quantity', { exact: true })
  await shoppingQuantity.focus()
  await shoppingQuantity.press('ControlOrMeta+A')
  await shoppingQuantity.press('Backspace')
  assert.equal(await shoppingQuantity.inputValue(), '')
  await wife.getByRole('button', { name: 'Save details', exact: true }).click()
  assert.equal(
    await wife.getByRole('dialog').count(),
    1,
    'Blank quantities cannot save the previous amount',
  )
  await replaceNumber(shoppingQuantity, '2')
  await wife.getByRole('button', { name: 'Save details', exact: true }).click()
  await owner
    .getByRole('button', { name: 'Check Avocado', exact: true })
    .filter({ hasText: 'Ripe' })
    .waitFor()
  assert.match(
    await owner
      .getByRole('button', { name: 'Check Avocado', exact: true })
      .innerText(),
    /2 pc/,
  )
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

  await addToCupboard(owner, 'Rice', '500', 'g')
  await owner
    .locator('.stock-row')
    .getByText(/500 g · confirmed/)
    .waitFor()
  await owner.waitForFunction(
    async () =>
      (await (await fetch('/api/state')).json()).state.pantry.rice?.amounts[0]
        ?.quantity === 500,
  )
  await stockMenu(owner, 'Rice', 'Edit amounts & use-by')
  assert.notEqual(
    await owner.evaluate(() => document.activeElement?.tagName),
    'INPUT',
    'The pantry editor does not focus a field (no phone keyboard)',
  )
  await replaceNumber(
    owner.getByLabel('Pantry quantity 1', { exact: true }),
    '750',
  )
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
    .getByRole('button', { name: 'Edit item details', exact: true })
    .click()
  const catalogDialog = owner.getByRole('dialog', {
    name: 'Edit catalog item',
    exact: true,
  })
  await catalogDialog
    .getByLabel('Item name', { exact: true })
    .fill('Rice for the cupboard')
  await catalogDialog
    .getByLabel('Search aliases', { exact: true })
    .fill('Cupboard rice')
  await catalogDialog
    .getByRole('button', { name: 'Save item', exact: true })
    .click()
  await catalogDialog.waitFor({ state: 'hidden' })
  assert.equal(
    await owner.getByLabel('Pantry quantity 1', { exact: true }).inputValue(),
    '750',
  )
  assert.equal(
    await owner.getByLabel('Pantry notes', { exact: true }).inputValue(),
    'Opened cupboard pack',
  )
  await owner
    .getByRole('heading', { name: 'Edit Rice for the cupboard', exact: true })
    .waitFor()
  await owner
    .getByRole('button', { name: 'Edit item details', exact: true })
    .click()
  await catalogDialog
    .getByRole('button', { name: 'Remove Cupboard rice', exact: true })
    .waitFor()
  assert.notEqual(
    await owner.evaluate(() => document.activeElement?.tagName),
    'INPUT',
    'The catalog editor does not focus a text field (no phone keyboard)',
  )
  await catalogDialog.getByLabel('Item name', { exact: true }).fill('Rice')
  await catalogDialog
    .getByRole('button', { name: 'Save item', exact: true })
    .click()
  await catalogDialog.waitFor({ state: 'hidden' })
  await wife.waitForFunction(async () =>
    (
      await (await fetch('/api/state')).json()
    ).state.productDetails.rice?.aliases?.includes('Cupboard rice'),
  )
  await owner
    .getByRole('dialog')
    .screenshot({ path: 'test-results/pantry-edit-mobile.png' })
  await ownerContext.setOffline(true)
  await owner
    .getByRole('button', { name: 'Save pantry entry', exact: true })
    .click()
  await stockMenu(owner, 'Rice', 'Edit amounts & use-by')
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
  await openStockRow(owner, 'Rice')
  await stockMenu(owner, 'Rice', 'Remove from cupboard')
  await owner
    .locator('.connection-pill')
    .filter({ hasText: 'Review changes' })
    .first()
    .waitFor({ state: 'attached' })
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
    .getByRole('button', { name: 'More for Rice', exact: true })
    .waitFor({ state: 'hidden' })
  await owner.waitForFunction(
    async () => !(await (await fetch('/api/state')).json()).state.pantry.rice,
  )
  await owner.reload()
  await settle(owner)
  assert.equal(
    await owner.locator('.stock-text strong', { hasText: /^Rice$/ }).count(),
    0,
  )
  assert.equal(await owner.getByText(/Review changes/).count(), 0)
  assert.equal(
    (await request(wife, '/state', undefined, 'GET')).state.pantry.rice,
    undefined,
  )
  await addToCupboard(owner, 'Rice', '500', 'g')
  await owner
    .locator('.stock-row')
    .getByText(/500 g · confirmed/)
    .waitFor()
  // New items can be created straight into the cupboard.
  await cupboardSearch(owner).fill('Homemade jam')
  await owner.getByRole('option', { name: /Create “Homemade jam”/ }).click()
  const jamDialog = owner.getByRole('dialog', { name: 'Something we have' })
  await jamDialog
    .getByRole('button', { name: 'Add to cupboard', exact: true })
    .click()
  await jamDialog.waitFor({ state: 'hidden' })
  await owner
    .getByRole('button', { name: 'More for Homemade jam', exact: true })
    .waitFor()
  // A misattributed entry moves to the right (here a new) item.
  await stockMenu(owner, 'Homemade jam', 'Change to another item')
  const moveDialog = owner.getByRole('dialog', {
    name: 'Change Homemade jam to…',
  })
  await moveDialog
    .getByLabel('Also delete “Homemade jam” from our items')
    .check()
  await moveDialog
    .getByRole('combobox', { name: 'Find the right item' })
    .fill('Strawberry jam')
  await moveDialog
    .getByRole('option', { name: /Create “Strawberry jam”/ })
    .click()
  await moveDialog.waitFor({ state: 'hidden' })
  await eventually(async () => {
    const moved = (await request(wife, '/state', undefined, 'GET')).state
    const jam = moved.customProducts.find((p) => p.name === 'Strawberry jam')
    return (
      jam &&
      moved.pantry[jam.id]?.amounts[0]?.quantity === 1 &&
      !moved.customProducts.some((p) => p.name === 'Homemade jam')
    )
  })
  // Used up keeps the entry as a warning that can be dismissed.
  await openStockRow(owner, 'Strawberry jam')
  await owner
    .getByRole('button', { name: 'Strawberry jam is used up', exact: true })
    .click()
  await owner
    .locator('.stock-group', { hasText: 'Running low' })
    .getByText('Strawberry jam', { exact: true })
    .waitFor()
  await openStockRow(owner, 'Strawberry jam')
  await owner
    .getByRole('button', {
      name: 'Dismiss warning for Strawberry jam',
      exact: true,
    })
    .click()
  await owner
    .locator('.stock-group', { hasText: 'Warnings dismissed' })
    .getByText('Strawberry jam', { exact: true })
    .waitFor()
  await openStockRow(owner, 'Strawberry jam')
  await owner
    .getByRole('button', { name: 'More for Strawberry jam', exact: true })
    .screenshot({ path: 'test-results/cupboard-row-actions.png' })
  await stockMenu(owner, 'Strawberry jam', 'Remove from cupboard')
  await owner
    .getByRole('button', { name: 'More for Strawberry jam', exact: true })
    .waitFor({ state: 'hidden' })
  console.log(
    'Cupboard search creates items into the cupboard; change item, used up, dismiss and remove passed.',
  )
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
    .getByRole('option', {
      name: 'Add new ingredient “Special family seasoning”',
      exact: true,
    })
    .click()
  await owner
    .getByRole('button', { name: 'Add ingredient', exact: true })
    .click()
  await owner.getByLabel('Ingredient', { exact: true }).fill('Rice')
  assert.equal(
    await owner
      .getByRole('option')
      .filter({ has: owner.locator('strong', { hasText: /^Rice$/ }) })
      .locator('img')
      .count(),
    1,
    'Existing ingredient suggestions display their artwork',
  )
  await owner.getByLabel('Ingredient', { exact: true }).press('ArrowDown')
  await owner.getByLabel('Ingredient', { exact: true }).press('Enter')
  const ingredientQuantity = owner.getByLabel('Quantity', { exact: true })
  await ingredientQuantity.focus()
  await ingredientQuantity.press('ControlOrMeta+A')
  await ingredientQuantity.press('Backspace')
  assert.equal(await ingredientQuantity.inputValue(), '')
  await owner
    .getByRole('button', { name: 'Add ingredient', exact: true })
    .click()
  assert.equal(
    await owner.locator('.editable-ingredients summary').count(),
    1,
    'A blank ingredient quantity cannot reuse stale numeric state',
  )
  await replaceNumber(ingredientQuantity, '300')
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
    .locator('.editable-ingredients summary')
    .filter({ hasText: 'Rice' })
    .click()
  await owner
    .getByRole('combobox', { name: 'Ingredient name for Rice', exact: true })
    .fill('Barley')
  assert.equal(
    await owner
      .getByRole('option', { name: /^Barley/ })
      .locator('img')
      .count(),
    1,
  )
  await owner
    .getByRole('combobox', { name: 'Ingredient name for Rice', exact: true })
    .press('ArrowDown')
  await owner
    .getByRole('combobox', { name: 'Ingredient name for Rice', exact: true })
    .press('Enter')
  await owner
    .getByLabel('Details for Rice', { exact: true })
    .fill('Rinse thoroughly')
  await owner
    .locator('.editable-ingredients summary')
    .filter({ hasText: 'Special family seasoning' })
    .click()
  await owner
    .getByRole('combobox', {
      name: 'Ingredient name for Special family seasoning',
      exact: true,
    })
    .fill('Heirloom family seasoning')
  await owner
    .getByRole('option', {
      name: 'Add new ingredient “Heirloom family seasoning”',
      exact: true,
    })
    .waitFor()
  await owner
    .getByRole('button', { name: 'Save to our recipe book', exact: true })
    .click()
  await owner
    .getByRole('button', { name: 'Open Family rice bowl', exact: true })
    .waitFor()
  const editedRecipeState = (await request(owner, '/state', undefined, 'GET'))
    .state
  const editedRecipe = editedRecipeState.recipeBook.find(
    (recipe) => recipe.name === 'Family rice bowl',
  )
  assert.deepEqual(
    editedRecipe.ingredients.find((i) => i.productId === 'barley'),
    { productId: 'barley', quantity: 300, unit: 'g', note: 'Rinse thoroughly' },
  )
  assert.ok(
    editedRecipeState.customProducts.some(
      (p) => p.name === 'Heirloom family seasoning',
    ),
  )
  assert.equal(
    editedRecipeState.productDetails?.rice?.name ?? 'Rice',
    'Rice',
    'Recipe ingredient replacement never renames the shared catalog product',
  )
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
  const mondayServings = owner.getByLabel('Servings for Monday', {
    exact: true,
  })
  await replaceNumber(mondayServings, '6')
  await mondayServings.press('ControlOrMeta+A')
  await mondayServings.press('Backspace')
  assert.equal(await mondayServings.inputValue(), '')
  await mondayServings.press('Tab')
  assert.equal(
    await mondayServings.inputValue(),
    '6',
    'Autosaved fields restore the last valid amount on blur',
  )
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
  await owner
    .locator('.shopping-heading')
    .screenshot({ path: 'test-results/store-picker-wrap-mobile.png' })
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
  const sheetFixtures = await owner.evaluate(async (encoded) => {
    const image = new Image()
    image.src = 'data:image/png;base64,' + encoded
    await image.decode()
    return Object.fromEntries(
      [2, 3, 4].map((grid) => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 1024
        const ctx = canvas.getContext('2d')
        const edge = 1024 / grid
        for (let row = 0; row < grid; row++)
          for (let col = 0; col < grid; col++)
            ctx.drawImage(
              image,
              col * edge + edge * 0.15,
              row * edge + edge * 0.15,
              edge * 0.7,
              edge * 0.7,
            )
        return [grid, canvas.toDataURL('image/png').split(',')[1]]
      }),
    )
  }, iconFixture)
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
      const grid = input.prompt?.match(/Required icon-sheet layout: (\d+)/)?.[1]
      res.end(
        JSON.stringify({
          data: [{ b64_json: sheetFixtures[grid] ?? iconFixture }],
        }),
      )
      return
    }
    const hasImages = input.messages?.some((message) =>
      Array.isArray(message.content),
    )
    const isStoreMap = input.messages?.[0]?.content?.includes(
      'Required store-map protocol:',
    )
    const itemDetails = input.messages?.[0]?.content?.includes(
      'Required item-details protocol:',
    )
      ? JSON.parse(
          itemText(input.messages[1].content)
            .replace('Shopping item: ', '')
            .split('\nSuggest')[0],
        )
      : null
    const itemPhoto = Array.isArray(input.messages?.[1]?.content)
    const content = itemDetails
      ? JSON.stringify({
          // Photos of oats match the built-in item instead of a duplicate.
          name: itemPhoto ? 'Oats' : (itemDetails.name ?? ''),
          productId: itemPhoto ? 'oats' : null,
          group: itemDetails.groups.at(-1),
          quantity: 500,
          unit: 'g',
          note: 'Fixture note',
          iconDescription: 'A small blue box',
          shelfLifeDays: 10,
        })
      : input.messages?.[0]?.content?.includes('Required shelf-life protocol:')
        ? JSON.stringify({
            items: JSON.parse(
              input.messages[1].content.replace('Items: ', ''),
            ).map((item, index) => ({
              productId: item.productId,
              days: index % 2 ? null : 5,
            })),
          })
        : isStoreMap
          ? JSON.stringify({
              message:
                'Start at produce, then dairy. Review the remaining aisles before saving.',
              order: ['Fruits', 'Vegetables', 'Milk & eggs'],
            })
          : hasImages
            ? JSON.stringify({
                message:
                  'Recipe transcribed. Review all quantities before saving.',
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
                      {
                        name: 'Calamansi peel',
                        productId: null,
                        category: null,
                        quantity: 1,
                        unit: 'g',
                        note: '',
                      },
                      {
                        name: 'Cassia buds',
                        productId: null,
                        category: null,
                        quantity: 1,
                        unit: 'g',
                        note: '',
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
  // The settings page may request the config more than once while it mounts,
  // so the outage lasts until the test recovers it explicitly.
  let failConfig = true
  const failingSettings = async (route) => {
    if (route.request().method() === 'GET' && failConfig) {
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
  failConfig = false
  await owner
    .getByRole('button', {
      name: 'Retry loading assistant settings',
      exact: true,
    })
    .click()
  await owner.getByText('Configure AI assistant', { exact: true }).waitFor()
  failConfig = true
  await owner.reload()
  await settle(owner)
  await owner
    .getByRole('button', {
      name: 'Retry loading assistant settings',
      exact: true,
    })
    .waitFor()
  failConfig = false
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
        product.icon === '🛒' &&
        !product.image &&
        !iconState.productImages[product.id],
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
  await ownerContext.grantPermissions(['geolocation'])
  await ownerContext.setGeolocation({ latitude: 60.21, longitude: 24.73 })
  await owner
    .getByRole('button', { name: 'Use my location', exact: true })
    .click()
  await owner.waitForFunction(
    () =>
      document.querySelector('.store-position input')?.value ===
      '60.210000, 24.730000',
  )
  await owner.getByLabel(/^Map position/).fill('somewhere')
  assert.ok(
    await owner
      .getByRole('button', { name: 'Save shop', exact: true })
      .isDisabled(),
  )
  await owner.getByLabel(/^Map position/).fill('60.2101, 24.7302')
  await owner
    .locator('.store-position')
    .screenshot({ path: 'test-results/store-position-mobile.png' })
  await ownerContext.clearPermissions()
  await owner
    .getByRole('button', { name: 'Generate icon', exact: true })
    .first()
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
  assert.deepEqual(editedShop.position, { lat: 60.2101, lng: 24.7302 })
  const wifeShop = wife.getByRole('combobox', {
    name: 'Shopping at',
    exact: true,
  })
  await wife.goto(frontendUrl)
  await settle(wife)
  const wifeShopBefore = await wifeShop.inputValue()
  await wifeContext.grantPermissions(['geolocation'])
  await wifeContext.setGeolocation({ latitude: 61.5, longitude: 23.76 })
  await wife.reload()
  await settle(wife)
  await wife.waitForFunction(
    () =>
      document.querySelector('[aria-label="Shopping at"]')?.value ===
      'Unknown shop',
  )
  await wife
    .locator('.shopping-heading')
    .screenshot({ path: 'test-results/store-picker-unknown-mobile.png' })
  await wifeContext.setGeolocation({ latitude: 60.2105, longitude: 24.731 })
  await wife.reload()
  await settle(wife)
  await wife.waitForFunction(
    () =>
      document.querySelector('[aria-label="Shopping at"]')?.value ===
      'Renamed Neighborhood Market',
  )
  await wifeContext.clearPermissions()
  await wifeShop.fill(wifeShopBefore)
  await wife
    .getByRole('option')
    .filter({ hasText: wifeShopBefore })
    .first()
    .click()
  assert.equal(await wifeShop.inputValue(), wifeShopBefore)
  console.log(
    'Shop map positions save, validate and auto-select the nearby (or unknown) shop on launch.',
  )
  for (const [id, name, category, image] of [
    ['existing-water-art', 'Water', 'Beverages', 'water'],
    ['existing-basil-art', 'Basil', 'Vegetables', 'basil'],
    [
      'existing-cheese-art',
      'Grated Emmental–mozzarella cheese',
      'Cheese',
      'grated-cheese',
    ],
  ]) {
    await request(owner, '/operations', {
      id: crypto.randomUUID(),
      operation: {
        type: 'patch',
        label: 'Existing family icon fixture',
        changes: [
          {
            collection: 'customProducts',
            key: id,
            field: null,
            before: null,
            after: { id, name, category, icon: '🛒', aliases: [] },
          },
        ],
      },
    })
    await request(owner, '/operations', {
      id: crypto.randomUUID(),
      operation: {
        type: 'addItem',
        productId: id,
        quantity: 1,
        unit: 'pc',
        note: '',
        accumulate: false,
      },
    })
    // Simulate an older saved list item that has no image association yet.
    const item = (
      await request(owner, '/state', undefined, 'GET')
    ).state.items.find((item) => item.id === id)
    await request(owner, '/operations', {
      id: crypto.randomUUID(),
      operation: {
        type: 'patch',
        label: 'Legacy icon fixture',
        changes: [
          {
            collection: 'items',
            key: id,
            field: 'image',
            before: item.image,
            after: null,
          },
        ],
      },
    })
    await wife.goto(frontendUrl)
    await settle(wife)
    await eventually(
      async () =>
        (await wife
          .getByRole('button', { name: `Check ${name}`, exact: true })
          .locator('img')
          .getAttribute('src')) === `/images/catalog/generated/${image}.webp`,
    )
  }
  console.log(
    'Known pre-existing custom items inherit appropriate default art, including legacy unpictured shopping entries.',
  )
  await owner.getByRole('button', { name: 'Edit shop', exact: true }).click()
  await owner
    .getByLabel('Upload store map', { exact: true })
    .setInputFiles('public/images/pasta.jpg')
  await owner
    .getByRole('button', { name: 'Suggest aisle order', exact: true })
    .waitFor({ state: 'visible' })
  await owner
    .getByRole('button', { name: 'Suggest aisle order', exact: true })
    .click()
  const mapProposal = owner.getByRole('region', {
    name: 'Suggested aisle order',
    exact: true,
  })
  await mapProposal.waitFor()
  assert.deepEqual(
    (await request(owner, '/state', undefined, 'GET')).state.stores.find(
      (store) => store.id === selectedShop.id,
    ).order,
    selectedShop.order,
    'Reading a map does not save a route',
  )
  for (const width of [320, 390, 1440]) {
    await owner.setViewportSize({ width, height: 900 })
    assert.ok(
      await owner
        .getByRole('dialog')
        .evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1),
      `Store map review fits at ${width}px`,
    )
    await owner
      .getByRole('dialog')
      .screenshot({ path: `test-results/store-map-review-${width}.png` })
  }
  await owner.setViewportSize({ width: 390, height: 844 })
  await mapProposal
    .getByRole('button', { name: 'Use this order', exact: true })
    .click()
  assert.deepEqual(
    (await request(owner, '/state', undefined, 'GET')).state.stores.find(
      (store) => store.id === selectedShop.id,
    ).order,
    selectedShop.order,
    'Accepting fills the editor draft; Save shop persists it',
  )
  await owner.getByText('Aisles in this shop · 3', { exact: true }).click()
  const aisleNames = () =>
    owner.getByRole('dialog').locator('.aisle-row strong').allTextContents()
  const vegetablesHandle = owner.getByRole('button', {
    name: /^Reorder Vegetables, position/,
  })
  // Keyboard reordering on the drag handle: down, then back up.
  await vegetablesHandle.focus()
  await vegetablesHandle.press('ArrowDown')
  await eventually(async () => (await aisleNames())[2] === 'Vegetables')
  await vegetablesHandle.press('ArrowUp')
  await eventually(async () => (await aisleNames())[1] === 'Vegetables')
  // A real pointer drag moves Vegetables above Fruits.
  const from = await vegetablesHandle.boundingBox()
  const to = await owner
    .getByRole('button', { name: /^Reorder Fruits, position/ })
    .boundingBox()
  await owner.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await owner.mouse.down()
  await owner.mouse.move(from.x + from.width / 2, to.y + 4, { steps: 12 })
  await owner.mouse.up()
  await eventually(async () => (await aisleNames())[0] === 'Vegetables')
  await owner
    .getByRole('button', { name: 'Remove Milk & eggs from shop', exact: true })
    .click()
  await owner.getByText('Add aisles', { exact: true }).click()
  await owner.getByLabel('Find an item group', { exact: true }).fill('milk')
  await owner
    .getByRole('button', { name: 'Add Milk & eggs to shop', exact: true })
    .click()
  await owner.getByRole('button', { name: 'Save shop', exact: true }).click()
  await eventually(
    async () =>
      JSON.stringify(
        (await request(wife, '/state', undefined, 'GET')).state.stores.find(
          (store) => store.id === selectedShop.id,
        ).order,
      ) === JSON.stringify(['Vegetables', 'Fruits', 'Milk & eggs']),
  )
  await owner.goto(frontendUrl)
  await settle(owner)
  const partialList = (
    await request(owner, '/state', undefined, 'GET')
  ).state.items.filter((item) => !item.checked)
  const visibleItems = await owner
    .locator('.item-grid .tile-check strong')
    .allTextContents()
  assert.deepEqual(
    [...visibleItems].sort(),
    partialList.map((item) => item.name).sort(),
    'Omitted aisles never hide groceries',
  )
  const positions = visibleItems.map((name) => {
    const item = partialList.find((item) => item.name === name)
    const position = ['Vegetables', 'Fruits', 'Milk & eggs'].indexOf(
      item.category,
    )
    return position < 0 ? 3 : position
  })
  assert.ok(
    positions.every((position, i) => i === 0 || position >= positions[i - 1]),
    'Unconfigured groups sort after the shop route',
  )
  await owner.goto(`${frontendUrl}/settings/stores`)
  await settle(owner)
  await owner
    .locator('.store-option')
    .filter({ hasText: 'Renamed Neighborhood Market' })
    .click()
  await owner
    .getByRole('button', { name: 'Remove Milk & eggs from shop', exact: true })
    .click()
  await owner.getByText('Add aisles', { exact: true }).click()
  await owner
    .getByRole('button', { name: 'Add Milk & eggs to shop', exact: true })
    .click()
  await owner.reload()
  await settle(owner)
  await owner
    .locator('.store-option')
    .filter({ hasText: 'Renamed Neighborhood Market' })
    .click()
  await owner
    .getByRole('button', { name: 'Remove Milk & eggs from shop', exact: true })
    .waitFor()
  console.log(
    'Private store-map review, editable aisle subsets, SSE persistence, omitted-item visibility and responsive controls passed.',
  )
  // Durable generation: closing an editor or reloading the page while an
  // image is being generated must not fail it, and reopening recovers the
  // finished picture so it can still be saved.
  for (const [id, name] of [
    ['recovery-tomatoes', 'Recovery tomatoes'],
    ['recovery-olives', 'Recovery olives'],
  ]) {
    await request(owner, '/operations', {
      id: crypto.randomUUID(),
      operation: {
        type: 'patch',
        label: 'Generation recovery fixture',
        changes: [
          {
            collection: 'customProducts',
            key: id,
            field: null,
            before: null,
            after: {
              id,
              name,
              category: 'Vegetables',
              icon: '🛒',
              aliases: [],
            },
          },
        ],
      },
    })
    await request(owner, '/operations', {
      id: crypto.randomUUID(),
      operation: {
        type: 'addItem',
        productId: id,
        quantity: 1,
        unit: 'pc',
        note: '',
        accumulate: false,
      },
    })
  }
  // New items: AI fills untouched fields, keeps chosen ones and draws an icon.
  await owner.goto(frontendUrl)
  await settle(owner)
  await owner
    .getByRole('combobox', { name: 'Add a shopping item' })
    .fill('Fixture margarine')
  await owner
    .getByRole('combobox', { name: 'Add a shopping item' })
    .press('Enter')
  const newItem = owner.getByRole('dialog', {
    name: 'Something for the basket',
  })
  await newItem.getByRole('button', { name: 'pack', exact: true }).click()
  await newItem.getByRole('button', { name: 'Fill in with AI' }).click()
  await eventually(
    async () =>
      (await newItem.getByLabel('A little more detail').inputValue()) ===
      'Fixture note',
  )
  assert.equal(
    await newItem.getByLabel('Unit', { exact: true }).inputValue(),
    'pack',
  )
  assert.equal(
    await newItem.getByLabel('Quantity', { exact: true }).inputValue(),
    '500',
  )
  const detailsRequest = providerRequests.findLast((entry) =>
    entry.messages?.[0]?.content?.includes('Required item-details protocol:'),
  )
  const sentDetails = JSON.parse(
    itemText(detailsRequest.messages[1].content)
      .replace('Shopping item: ', '')
      .split('\nSuggest')[0],
  )
  assert.equal(sentDetails.unit, 'pack')
  assert.equal(sentDetails.quantity, null)
  assert.equal(
    await newItem.locator('.editor-more select').inputValue(),
    sentDetails.groups.at(-1),
  )
  await owner.waitForFunction(
    () => !!document.querySelector('.image-field-preview[src^="/api/images/"]'),
    null,
    { timeout: 45000 },
  )
  assert.ok(
    providerRequests.some((entry) =>
      entry.prompt?.includes('Fixture margarine: A small blue box'),
    ),
    'The icon request uses the suggested visual description',
  )
  await newItem
    .getByRole('button', { name: 'Add to shopping list', exact: true })
    .click()
  assert.match(
    await owner
      .getByRole('button', { name: 'Check Fixture margarine', exact: true })
      .innerText(),
    /500 pack[\s\S]*Fixture note/,
  )
  const fixtureMargarine = (
    await request(owner, '/state', undefined, 'GET')
  ).state.customProducts.find((product) => product.name === 'Fixture margarine')
  assert.equal(
    (await request(owner, '/state', undefined, 'GET')).state.shelfLifeDays?.[
      fixtureMargarine.id
    ],
    10,
    'The suggested shelf life is saved with the new item',
  )
  // "Fill in & add" closes at once; the server finishes it in the background.
  await owner
    .getByRole('combobox', { name: 'Add a shopping item' })
    .fill('Fixture ghee')
  await owner
    .getByRole('combobox', { name: 'Add a shopping item' })
    .press('Enter')
  const backgroundItem = owner.getByRole('dialog', {
    name: 'Something for the basket',
  })
  await backgroundItem.getByRole('button', { name: 'kg', exact: true }).click()
  await owner.screenshot({ path: 'test-results/fill-in-and-add-mobile.png' })
  await backgroundItem
    .getByRole('button', { name: 'Fill in & add', exact: true })
    .click()
  await backgroundItem.waitFor({ state: 'hidden' })
  const backgroundTile = owner.getByRole('button', {
    name: 'Check Fixture ghee',
    exact: true,
  })
  await backgroundTile.waitFor({ timeout: 30000 })
  assert.match(await backgroundTile.innerText(), /500 kg[\s\S]*Fixture note/)
  // A photo from the empty + button reuses a matching existing item.
  await owner.getByRole('button', { name: 'Add item', exact: true }).click()
  const photoItem = owner.getByRole('dialog', {
    name: 'Something for the basket',
  })
  await photoItem
    .getByLabel('Add from a photo')
    .setInputFiles('public/images/pasta.jpg')
  await photoItem.getByText('Already in your items').waitFor()
  assert.equal(await photoItem.getByLabel('Item name').inputValue(), 'Oats')
  const customCount = (await request(owner, '/state', undefined, 'GET')).state
    .customProducts.length
  await photoItem
    .getByRole('button', { name: 'Add to shopping list', exact: true })
    .click()
  await owner.getByRole('button', { name: 'Check Oats', exact: true }).waitFor()
  await eventually(async () => {
    const state = (await request(owner, '/state', undefined, 'GET')).state
    return (
      state.customProducts.length === customCount &&
      state.itemPhotos?.oats?.[0]?.startsWith('/api/images/')
    )
  })
  // Fire-and-forget: a photo marks Oats bought without any further taps.
  await owner.getByRole('button', { name: 'Snap an item', exact: true }).click()
  await owner.screenshot({ path: 'test-results/photo-capture-mobile.png' })
  // A copied image can be pasted instead of taking a photo.
  await owner
    .context()
    .grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(owner.url()).origin,
    })
  await owner.evaluate(async () => {
    const photo = await createImageBitmap(
      await (await fetch('/images/pasta.jpg')).blob(),
    )
    const canvas = new OffscreenCanvas(photo.width, photo.height)
    canvas.getContext('2d').drawImage(photo, 0, 0)
    const png = await canvas.convertToBlob({ type: 'image/png' })
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
  })
  await owner
    .getByRole('dialog', { name: 'Snap an item' })
    .getByRole('button', {
      name: 'I’m buying it now from a pasted image',
      exact: true,
    })
    .click()
  await owner.getByRole('dialog', { name: 'Snap an item' }).waitFor({
    state: 'hidden',
  })
  await owner.screenshot({ path: 'test-results/photo-pending-mobile.png' })
  await owner
    .getByRole('button', { name: 'Restore Oats', exact: true })
    .waitFor({ timeout: 30000 })
  // AI-added work stays marked until someone approves it.
  const aiChip = owner.getByRole('button', {
    name: 'Restore Oats',
    exact: true,
  })
  await aiChip.locator('.ai-chip-mark').waitFor()
  await aiChip.click({ button: 'right' })
  await owner.getByText('Added by AI.', { exact: false }).waitFor()
  await owner.getByRole('button', { name: 'Looks right', exact: true }).click()
  await eventually(
    async () =>
      !(await request(owner, '/state', undefined, 'GET')).state.aiAdded?.oats,
  )
  // "Snap what we have" adds to the cupboard in the background, marked AI.
  await owner.goto(`${frontendUrl}/cupboard`)
  await settle(owner)
  await owner
    .getByLabel('Snap what we have', { exact: true })
    .setInputFiles('public/images/pasta.jpg')
  await owner.getByText(/add it to the cupboard in the background/).waitFor()
  await eventually(
    async () =>
      (await request(owner, '/state', undefined, 'GET')).state.aiAdded?.oats ===
      'pantry',
  )
  await owner
    .locator('.stock-row')
    .filter({ hasText: 'Oats' })
    .locator('.ai-badge')
    .waitFor()
  await owner.goto(frontendUrl)
  await settle(owner)
  console.log(
    'Fire-and-forget photos check off or stock items, stay marked AI until approved.',
  )
  // A variety of a known item becomes that item with a note.
  await owner
    .getByRole('combobox', { name: 'Add a shopping item' })
    .fill('peppermint tea')
  await owner.getByRole('option', { name: /Note: peppermint/ }).click()
  assert.match(
    await owner
      .getByRole('button', { name: 'Check Tea', exact: true })
      .innerText(),
    /peppermint/,
  )
  await owner.goto(`${frontendUrl}/settings/items`)
  await settle(owner)
  await owner
    .getByRole('button', { name: 'Estimate shelf lives with AI' })
    .click()
  await owner.getByText(/Set shelf lives for \d+ of your items/).waitFor()
  const estimated = (await request(owner, '/state', undefined, 'GET')).state
  assert.ok(
    Object.values(estimated.shelfLifeDays ?? {}).includes(5),
    'Bulk estimates are applied',
  )
  console.log(
    'AI item details keep chosen fields, save a shelf life and generate a matching icon; bulk shelf-life estimates apply.',
  )
  await owner.goto(frontendUrl)
  await settle(owner)
  imageDelay = 8000
  await hold(
    owner,
    owner.getByRole('button', { name: 'Check Recovery tomatoes', exact: true }),
  )
  await owner.locator('.editor-more summary').click()
  await owner
    .getByRole('button', { name: 'Generate icon', exact: true })
    .first()
    .click()
  await owner.getByText(/Waiting to start|Generating your icon/).waitFor()
  await owner.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await owner.getByRole('dialog').waitFor({ state: 'hidden' })
  await hold(
    owner,
    owner.getByRole('button', { name: 'Check Recovery tomatoes', exact: true }),
  )
  await owner.waitForFunction(
    () =>
      !!document.querySelector('.image-field-preview[src^="/api/images/"]') ||
      !!document.querySelector('.image-field [role="status"]'),
  )
  await owner.waitForFunction(
    () => !!document.querySelector('.image-field-preview[src^="/api/images/"]'),
    null,
    { timeout: 45000 },
  )
  assert.equal(
    await owner.getByRole('dialog').locator('.form-error').count(),
    0,
  )
  await owner.getByRole('button', { name: 'Save details', exact: true }).click()
  await owner.getByRole('dialog').waitFor({ state: 'hidden' })
  await eventually(async () =>
    (
      (await request(owner, '/state', undefined, 'GET')).state.productImages?.[
        'recovery-tomatoes'
      ] ?? ''
    ).startsWith('/api/images/'),
  )
  // A full reload (phone asleep or tab dropped) still recovers the job.
  await hold(
    owner,
    owner.getByRole('button', { name: 'Check Recovery olives', exact: true }),
  )
  await owner.locator('.editor-more summary').click()
  await owner
    .getByRole('button', { name: 'Generate icon', exact: true })
    .first()
    .click()
  await owner.getByText(/Waiting to start|Generating your icon/).waitFor()
  await owner.reload()
  await settle(owner)
  await hold(
    owner,
    owner.getByRole('button', { name: 'Check Recovery olives', exact: true }),
  )
  await owner.waitForFunction(
    () => !!document.querySelector('.image-field-preview[src^="/api/images/"]'),
    null,
    { timeout: 45000 },
  )
  await owner.getByRole('button', { name: 'Save details', exact: true }).click()
  await owner.getByRole('dialog').waitFor({ state: 'hidden' })
  await eventually(async () =>
    (
      (await request(owner, '/state', undefined, 'GET')).state.productImages?.[
        'recovery-olives'
      ] ?? ''
    ).startsWith('/api/images/'),
  )
  assert.equal(
    await owner.getByText('Failed to fetch', { exact: false }).count(),
    0,
    'A sleeping phone or reload never surfaces a raw fetch failure',
  )
  imageDelay = 0
  await owner.goto(`${frontendUrl}/settings/stores`)
  await settle(owner)
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
  const visionRequest = providerRequests.find(
    (request) =>
      request.messages?.some((message) => Array.isArray(message.content)) &&
      !request.messages?.[0]?.content?.includes(
        'Required store-map protocol:',
      ) &&
      !request.messages?.[0]?.content?.includes(
        'Required item-details protocol:',
      ),
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
  await owner
    .getByRole('button', { name: 'Generating dish photo…', exact: true })
    .waitFor()
  // Closing and reopening the assistant keeps collecting the server-side job.
  await owner.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await owner
    .getByRole('button', { name: 'Open family assistant', exact: true })
    .click()
  if (!(await owner.locator('.proposal-recipe').evaluate((node) => node.open)))
    await owner.locator('.proposal-recipe summary').click()
  await owner.locator('.proposal-dish-photo').waitFor()
  await owner
    .getByRole('button', { name: 'Generate icon', exact: true })
    .first()
    .click()
  await owner
    .getByRole('button', { name: 'Regenerate icon', exact: true })
    .waitFor()
  const firstDraftIcon = await owner
    .locator('.proposal-products img')
    .first()
    .getAttribute('src')
  const beforeBatchRequests = providerRequests.filter(
    (request) => request.background === 'transparent',
  ).length
  await owner
    .getByRole('button', { name: 'Generate missing icons (2)', exact: true })
    .click()
  await owner.waitForFunction(
    () =>
      [...document.querySelectorAll('.proposal-products img')].filter((img) =>
        img.getAttribute('src')?.startsWith('/api/images/'),
      ).length === 3,
  )
  assert.equal(
    providerRequests.filter((request) => request.background === 'transparent')
      .length,
    beforeBatchRequests + 1,
    'Two draft icons share one provider request',
  )
  assert.equal(
    await owner.locator('.proposal-products img').first().getAttribute('src'),
    firstDraftIcon,
    'Batch generation preserves an existing chosen icon',
  )
  assert.ok(
    !(
      await request(owner, '/state', undefined, 'GET')
    ).state.customProducts.some((product) => product.name === 'Cassia buds'),
    'Generated icon drafts await review/save',
  )
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
  await owner.getByRole('button', { name: 'All recipes', exact: true }).click()
  await owner.getByRole('button', { name: 'Add recipe', exact: true }).click()
  await owner
    .getByLabel('Recipe name', { exact: true })
    .fill('Batch icon recipe')
  await owner
    .getByRole('combobox', { name: 'Tags', exact: true })
    .fill('Desserts')
  await owner
    .getByRole('option', { name: 'Create “Desserts”', exact: true })
    .click()
  await owner
    .getByRole('checkbox', { name: 'Include in meal planning', exact: true })
    .uncheck()
  for (const name of [
    'Family saffron petals',
    'Family juniper pollen',
    'Rice',
  ]) {
    await owner
      .getByRole('combobox', { name: 'Ingredient', exact: true })
      .fill(name)
    await owner
      .getByRole('button', { name: 'Add ingredient', exact: true })
      .click()
  }
  await owner
    .getByLabel('How to make it', { exact: true })
    .fill('Cook, season and serve.')
  const recipeBatchRequests = providerRequests.filter(
    (request) => request.background === 'transparent',
  ).length
  await owner
    .getByRole('button', {
      name: 'Generate missing ingredient icons',
      exact: true,
    })
    .click()
  await owner.waitForFunction(
    () =>
      [
        ...document.querySelectorAll('.editable-ingredients summary img'),
      ].filter((img) => img.getAttribute('src')?.startsWith('/api/images/'))
        .length === 2,
  )
  assert.equal(
    providerRequests.filter((request) => request.background === 'transparent')
      .length,
    recipeBatchRequests + 1,
  )
  assert.ok(
    !(
      await request(owner, '/state', undefined, 'GET')
    ).state.customProducts.some((p) => p.name === 'Family saffron petals'),
  )
  assert.ok(
    (
      await owner
        .locator('.editable-ingredients summary')
        .filter({ hasText: 'Rice' })
        .locator('img')
        .getAttribute('src')
    ).startsWith('/images/'),
  )
  await owner
    .getByRole('combobox', { name: 'Ingredient', exact: true })
    .fill('Oat')
  for (const width of [320, 390, 1440]) {
    await owner.setViewportSize({ width, height: 844 })
    await owner
      .getByRole('combobox', { name: 'Ingredient', exact: true })
      .focus()
    await owner
      .getByRole('dialog')
      .screenshot({ path: `test-results/ingredient-picker-batch-${width}.png` })
    assert.equal(
      await owner.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    )
  }
  await owner
    .getByRole('combobox', { name: 'Ingredient', exact: true })
    .fill('')
  await owner.setViewportSize({ width: 390, height: 844 })
  await owner
    .getByRole('button', { name: 'Save to our recipe book', exact: true })
    .click()
  await owner
    .getByRole('button', { name: 'Open Batch icon recipe', exact: true })
    .waitFor()
  const batchRecipeState = (await request(owner, '/state', undefined, 'GET'))
    .state
  const batchIngredients = batchRecipeState.customProducts.filter((p) =>
    ['Family saffron petals', 'Family juniper pollen'].includes(p.name),
  )
  assert.equal(batchIngredients.length, 2)
  for (const ingredient of batchIngredients) {
    const image = batchRecipeState.productImages[ingredient.id]
    assert.ok(image?.startsWith('/api/images/'))
    assert.equal((await wife.request.get(frontendUrl + image)).status(), 200)
    assert.equal((await fetch(backendUrl + image)).status, 401)
  }
  console.log(
    'Recipe ingredient icon autocomplete, local replacement, batch draft review and shared private crops passed.',
  )
  await owner
    .getByRole('button', { name: 'Filter by tag Desserts', exact: true })
    .click()
  await owner
    .getByRole('button', { name: 'Open Batch icon recipe', exact: true })
    .waitFor()
  assert.equal(
    batchRecipeState.recipeBook.find(
      (recipe) => recipe.name === 'Batch icon recipe',
    ).mealPlanEligible,
    false,
  )
  await owner.goto(`${frontendUrl}/week`)
  await settle(owner)
  await owner.locator('.unplanned-button, .planned-meal').first().click()
  assert.equal(
    await owner
      .getByRole('dialog')
      .getByRole('button', { name: /Batch icon recipe/ })
      .count(),
    0,
  )
  await owner.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await owner
    .getByRole('button', { name: 'Suggest lunches', exact: true })
    .click()
  assert.equal(
    await owner
      .getByRole('dialog')
      .getByText('Batch icon recipe', { exact: true })
      .count(),
    0,
  )
  await owner.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await wife.goto(`${frontendUrl}/recipes`)
  await settle(wife)
  await wife
    .getByRole('button', { name: 'Filter by tag Desserts', exact: true })
    .click()
  await wife
    .getByRole('button', { name: 'Open Batch icon recipe', exact: true })
    .click()
  await wife.getByRole('button', { name: 'Edit recipe', exact: true }).click()
  assert.equal(
    await wife
      .getByRole('checkbox', { name: 'Include in meal planning', exact: true })
      .isChecked(),
    false,
  )
  await wife
    .getByRole('checkbox', { name: 'Include in meal planning', exact: true })
    .check()
  await wife
    .getByRole('button', { name: 'Save to our recipe book', exact: true })
    .click()
  await owner.reload()
  await settle(owner)
  await owner.locator('.unplanned-button, .planned-meal').first().click()
  await owner
    .getByRole('dialog')
    .getByRole('button', { name: /Batch icon recipe/ })
    .waitFor()
  await owner.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await wife.goto(`${frontendUrl}/settings`)
  console.log(
    'User-created dessert collections, planning exclusion, lunch suggestion filtering and shared re-enabling passed.',
  )
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
  await replaceNumber(
    owner.getByLabel('Consumption quantity', { exact: true }),
    '0.5',
  )
  await replaceNumber(
    owner.getByLabel('Consumption quantity', { exact: true }),
    '6',
  )
  await owner.getByLabel('Consumption unit', { exact: true }).fill('pc')
  await replaceNumber(
    owner.getByLabel('Consumption period (days)', { exact: true }),
    '7',
  )
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
  assert.ok(
    await owner
      .getByRole('checkbox', { name: 'Spoils after a while', exact: true })
      .isChecked(),
    'Built-in apples come with a shelf life',
  )
  assert.equal(
    await owner.getByLabel('Shelf life (days)', { exact: true }).inputValue(),
    '28',
  )
  await replaceNumber(
    owner.getByLabel('Shelf life (days)', { exact: true }),
    '10',
  )
  await owner.getByRole('button', { name: 'Save item', exact: true }).click()
  await eventually(
    async () =>
      (await request(wife, '/state', undefined, 'GET')).state.shelfLifeDays
        ?.apples === 10,
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
  assert.equal(
    await owner.getByLabel('Shelf life (days)', { exact: true }).inputValue(),
    '10',
  )
  await owner
    .getByRole('checkbox', { name: 'Set consumption rate', exact: true })
    .uncheck()
  await owner
    .getByRole('checkbox', { name: 'Spoils after a while', exact: true })
    .uncheck()
  await owner.getByRole('button', { name: 'Save item', exact: true }).click()
  await eventually(
    async () =>
      (await request(wife, '/state', undefined, 'GET')).state.shelfLifeDays
        ?.apples === 0,
  )
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
  // Three weekly purchases at the accepted 6 pc / 7 days leave none by now.
  await owner.goto(frontendUrl)
  await settle(owner)
  const lowApples = owner
    .locator('.running-low')
    .getByRole('button', { name: /^Add (Eating )?apples, /, exact: false })
  await lowApples.waitFor()
  await lowApples.click()
  const appleTile = owner.locator('.item-tile .tile-check').filter({
    hasText: /apples/i,
  })
  await appleTile.waitFor()
  assert.match(await appleTile.innerText(), /6 pc/)
  await appleTile.click()
  // Descriptions: a new item keeps its note as the default, and an edited
  // note becomes the new default only when asked.
  const soapSearch = owner.getByRole('combobox', {
    name: 'Add a shopping item',
  })
  await soapSearch.fill('Fixture soap')
  await soapSearch.press('Enter')
  const soapDialog = owner.getByRole('dialog', {
    name: 'Something for the basket',
  })
  await soapDialog.getByLabel('A little more detail').fill('Lavender')
  await soapDialog
    .getByRole('button', { name: 'Add to shopping list', exact: true })
    .click()
  await soapDialog.waitFor({ state: 'hidden' })
  const soap = async () =>
    (await request(wife, '/state', undefined, 'GET')).state.customProducts.find(
      (product) => product.name === 'Fixture soap',
    )
  await eventually(async () => (await soap())?.description === 'Lavender')
  await owner.waitForTimeout(900)
  await hold(
    owner,
    owner.getByRole('button', { name: 'Check Fixture soap', exact: true }),
  )
  const soapEditor = owner.getByRole('dialog', { name: 'Fixture soap' })
  assert.equal(
    await soapEditor.getByLabel('Use this note next time too').count(),
    0,
    'An unchanged note offers nothing to keep',
  )
  await soapEditor.getByLabel('A little more detail').fill('Unscented')
  await soapEditor.getByLabel('Use this note next time too').check()
  await owner.screenshot({ path: 'test-results/keep-note-mobile.png' })
  await soapEditor
    .getByRole('button', { name: 'Remove from list', exact: true })
    .click()
  await owner
    .getByRole('button', { name: 'Check Fixture soap', exact: true })
    .waitFor({ state: 'detached' })
  assert.equal(
    (await soap()).description,
    'Lavender',
    'Removing the entry does not save its edited note',
  )
  await soapSearch.fill('Fixture soap')
  await soapSearch.press('Enter')
  await owner
    .getByRole('button', { name: 'Check Fixture soap', exact: true })
    .waitFor()
  // Close the search suggestions that would cover the tile.
  await soapSearch.press('Escape')
  await owner.waitForTimeout(900)
  await hold(
    owner,
    owner.getByRole('button', { name: 'Check Fixture soap', exact: true }),
  )
  await soapEditor.getByLabel('A little more detail').fill('Unscented')
  await soapEditor.getByLabel('Use this note next time too').check()
  await soapEditor
    .getByRole('button', { name: 'Save details', exact: true })
    .click()
  await eventually(async () => (await soap())?.description === 'Unscented')
  await owner.waitForTimeout(900)
  await hold(
    owner,
    owner.getByRole('button', { name: 'Check Fixture soap', exact: true }),
  )
  await soapEditor
    .getByRole('button', { name: 'Remove from list', exact: true })
    .click()
  await soapSearch.fill('Fixture soap')
  await soapSearch.press('Enter')
  assert.match(
    await owner
      .getByRole('button', { name: 'Check Fixture soap', exact: true })
      .innerText(),
    /Unscented/,
  )
  console.log('Item descriptions fill in notes and change only when asked.')
  // One-off items: made from the add dialog or marked later, they skip the
  // cupboard and leave the household catalog once the trip is finished.
  const oneOffLabel = 'One-off: forget it once it’s bought'
  const shoppingSearch = owner.getByRole('combobox', {
    name: 'Add a shopping item',
  })
  for (const name of ['Fixture blanket', 'Fixture towel']) {
    await shoppingSearch.fill(name)
    await shoppingSearch.press('Enter')
    const dialog = owner.getByRole('dialog', {
      name: 'Something for the basket',
    })
    if (name === 'Fixture blanket') {
      await dialog.getByLabel(oneOffLabel).check()
      await owner.screenshot({ path: 'test-results/one-off-new-mobile.png' })
    }
    await dialog
      .getByRole('button', { name: 'Add to shopping list', exact: true })
      .click()
    await dialog.waitFor({ state: 'hidden' })
  }
  const towelTile = owner.getByRole('button', {
    name: 'Check Fixture towel',
    exact: true,
  })
  // Lifting the finger after a hold must not tick what opened beneath it.
  await hold(owner, towelTile)
  const towelEditor = owner.getByRole('dialog', { name: 'Fixture towel' })
  await owner.waitForTimeout(500)
  assert.equal(await towelEditor.getByLabel(oneOffLabel).isChecked(), false)
  await towelEditor.getByLabel(oneOffLabel).check()
  await towelEditor
    .getByRole('button', { name: 'Save details', exact: true })
    .click()
  await eventually(
    async () =>
      (await request(wife, '/state', undefined, 'GET')).state.customProducts
        .filter((product) => product.name.startsWith('Fixture '))
        .filter((product) => product.oneOff).length === 2,
  )
  // Taps right after opening an editor are ignored as the hold's release.
  await owner.waitForTimeout(900)
  for (const name of ['Fixture blanket', 'Fixture towel']) {
    await owner
      .getByRole('button', { name: `Check ${name}`, exact: true })
      .click()
    await owner
      .getByRole('button', { name: `Restore ${name}`, exact: true })
      .waitFor()
  }
  // The marks and checks survive a reload.
  await owner.reload()
  await settle(owner)
  for (const name of ['Fixture blanket', 'Fixture towel'])
    await owner
      .getByRole('button', { name: `Restore ${name}`, exact: true })
      .waitFor()
  const oneOffIds = (
    await request(owner, '/state', undefined, 'GET')
  ).state.customProducts
    .filter((product) => product.oneOff)
    .map((product) => product.id)
  await owner.getByRole('button', { name: 'Finish trip' }).click()
  const trip = owner.getByRole('dialog', { name: 'Trip complete!' })
  await trip.waitFor()
  assert.match(await trip.textContent(), /Items\s*\d+/i)
  await trip.getByRole('button', { name: 'Done', exact: true }).click()
  const leftovers = async () => {
    const state = (await request(wife, '/state', undefined, 'GET')).state
    return oneOffIds.flatMap((id) =>
      [
        state.customProducts.some((product) => product.id === id) && 'product',
        state.items.some((item) => item.id === id) && 'item',
        state.pantry[id] && 'pantry',
        state.purchases[id] && 'purchase',
      ]
        .filter(Boolean)
        .map((kind) => `${id}: ${kind}`),
    )
  }
  await eventually(async () => !(await leftovers()).length).catch(() => {})
  assert.deepEqual(await leftovers(), [], 'One-off items leave no trace')
  await shoppingSearch.fill('Fixture blanket')
  assert.equal(
    await owner
      .getByRole('option', { name: /Fixture blanket/ })
      .filter({ hasNotText: 'Create' })
      .count(),
    0,
    'A bought one-off item is no longer suggested',
  )
  await shoppingSearch.fill('')
  console.log('One-off items skip the cupboard and leave after the trip.')
  await owner.goto(frontendUrl + '/cupboard')
  await settle(owner)
  await owner
    .locator('.stock-row')
    .filter({ hasText: /apples/i })
    .waitFor()
  await owner.getByRole('tab', { name: 'Trends', exact: true }).click()
  await owner.getByText('Items bought per week', { exact: true }).waitFor()
  assert.ok((await owner.locator('.bar-chart .bar').count()) >= 19)
  await owner.getByRole('tab', { name: 'History', exact: true }).click()
  await owner
    .getByText(/Finished shopping · \d+ items/)
    .first()
    .waitFor()
  console.log(
    'Running-low projection, usual quantities, trip summary, cupboard trends and history passed.',
  )
  for (const width of [320, 390, 768, 1440]) {
    await owner.setViewportSize({ width, height: 900 })
    for (const path of [
      '/',
      '/week',
      '/recipes',
      '/cupboard',
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
    await owner.goto(frontendUrl + '/cupboard')
    await settle(owner)
    await owner.screenshot({ path: 'mockups/pantry-mobile.png' })
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
