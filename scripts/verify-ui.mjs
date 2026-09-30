import assert from 'node:assert/strict'
import { launchBrowser, baseUrl, settle } from './browser.mjs'

const browser = await launchBrowser()
const errors = []
async function hold(page, button) {
  await button.scrollIntoViewIfNeeded()
  const box = await button.boundingBox()
  const client = await page.context().newCDPSession(page)
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
  })
  await page.getByRole('dialog').waitFor()
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
  await client.detach()
}
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
    isMobile: true,
    hasTouch: true,
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(baseUrl)
  await settle(page)
  // Scrolling from a tile must cancel its hold without checking it.
  const avocado = page.getByRole('button', {
    name: 'Check Avocado',
    exact: true,
  })
  const avocadoBox = await avocado.boundingBox()
  const touch = await context.newCDPSession(page)
  const x = avocadoBox.x + avocadoBox.width / 2
  const y = avocadoBox.y + avocadoBox.height / 2
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y }],
  })
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x, y: y - 100 }],
  })
  await page.waitForTimeout(650)
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
  await touch.detach()
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(
    await page
      .getByRole('button', { name: 'Restore Avocado', exact: true })
      .count(),
    0,
  )
  await page.getByRole('button', { name: 'Check Avocado', exact: true }).click()
  await page
    .getByRole('button', { name: 'Restore Avocado', exact: true })
    .waitFor()
  await page
    .getByRole('button', { name: 'Restore Avocado', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Check Avocado', exact: true })
    .waitFor()
  await hold(
    page,
    page.getByRole('button', { name: 'Check Avocado', exact: true }),
  )
  await page
    .getByLabel('A little more detail')
    .fill('Perfectly ripe · test note')
  await page.getByRole('button', { name: 'Save details', exact: true }).click()
  assert.match(
    await page
      .getByRole('button', { name: 'Check Avocado', exact: true })
      .innerText(),
    /Perfectly ripe/,
  )
  assert.equal(await page.locator('.tile-edit').count(), 0)
  // A normal tap still checks; holding a checked entry edits without restoring it.
  await page.waitForTimeout(850)
  await page.getByRole('button', { name: 'Check Avocado', exact: true }).click()
  await hold(
    page,
    page.getByRole('button', { name: 'Restore Avocado', exact: true }),
  )
  await page.getByLabel('A little more detail').fill('Checked item details')
  await page.getByRole('button', { name: 'Save details', exact: true }).click()
  assert.equal(
    await page
      .getByRole('button', { name: 'Restore Avocado', exact: true })
      .count(),
    1,
  )
  await page.waitForTimeout(850)
  await page
    .getByRole('button', { name: 'Restore Avocado', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Check Avocado', exact: true })
    .press('Shift+F10')
  await page.getByRole('dialog').waitFor()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page
    .getByRole('combobox', { name: 'Add a shopping item' })
    .fill('Carro')
  await page.getByRole('option', { name: /Carrots/ }).click()
  await page
    .getByRole('button', { name: 'Check Carrots', exact: true })
    .waitFor()
  await page
    .getByRole('combobox', { name: 'Add a shopping item' })
    .fill('Family snack mix')
  await page.getByRole('button', { name: 'Add item', exact: true }).click()
  await page
    .getByRole('combobox', { name: 'Group', exact: true })
    .selectOption('Snacks & sweets')
  await page
    .getByRole('button', { name: 'Add to shopping list', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Check Family snack mix', exact: true })
    .waitFor()
  const otherTab = await context.newPage()
  await otherTab.goto(baseUrl)
  await settle(otherTab)
  await page.getByRole('button', { name: 'Check Carrots', exact: true }).click()
  await otherTab
    .getByRole('button', { name: 'Restore Carrots', exact: true })
    .waitFor()
  await page.reload()
  await page
    .getByRole('button', { name: 'Restore Carrots', exact: true })
    .waitFor()
  await page
    .getByRole('combobox', { name: 'Shopping at', exact: true })
    .fill('Lidl')
  await page.getByRole('option', { name: /Lidl/ }).click()
  assert.match(
    await page.locator('.shopping-group h2').first().innerText(),
    /Bread & pastries/,
  )
  await page
    .getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('link', { name: 'Recipes', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Open Green goddess pasta', exact: true })
    .click()
  await page.getByRole('button', { name: 'More servings', exact: true }).click()
  await page
    .getByRole('button', { name: 'Add 7 ingredients to list', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Added to our shopping list', exact: true })
    .waitFor()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page
    .getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('link', { name: 'Shop', exact: true })
    .click()
  await page.getByRole('button', { name: 'Check Pasta', exact: true }).waitFor()
  assert.equal(
    await page
      .getByRole('button', { name: 'Check Pasta', exact: true })
      .count(),
    1,
  )
  assert.match(
    await page
      .getByRole('button', { name: 'Check Pasta', exact: true })
      .innerText(),
    /900 g/,
  )
  await page.goto(`${baseUrl}/week`)
  await page.getByRole('button', { name: 'Next week', exact: true }).click()
  await page
    .getByRole('button', { name: 'Suggest lunches', exact: true })
    .click()
  await page.getByRole('button', { name: 'Use this plan', exact: true }).click()
  assert.equal(await page.locator('.planned-meal').count(), 7)
  assert.equal(
    await page
      .getByRole('button', { name: 'Shop this week', exact: true })
      .count(),
    0,
  )
  await otherTab
    .getByRole('button', { name: 'Check Spinach', exact: true })
    .waitFor()
  assert.match(
    await otherTab
      .getByRole('button', { name: 'Check Spinach', exact: true })
      .innerText(),
    /Meal plan/,
  )
  await page.goto(`${baseUrl}/settings`)
  await page
    .getByRole('button', { name: 'Move Fruit & vegetables up', exact: true })
    .click()
  assert.match(
    await page.locator('.aisle-list li').first().innerText(),
    /Fruit & vegetables/,
  )
  await page.getByRole('button', { name: 'Add store', exact: true }).click()
  await page.getByLabel('Store name', { exact: true }).fill('Test shop')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Add store', exact: true })
    .click()
  await page
    .getByRole('button', { name: /Test shop Our favorite shop/ })
    .waitFor()
  await page.goto(`${baseUrl}/recipes`)
  await page.getByRole('button', { name: 'Add recipe', exact: true }).click()
  await page.getByLabel('Recipe name', { exact: true }).fill('Test family bowl')
  await page
    .getByRole('button', { name: 'Add ingredient', exact: true })
    .click()
  await page
    .getByLabel('How to make it', { exact: true })
    .fill('Chop the avocado.\nEnjoy together.')
  await page
    .getByRole('button', { name: 'Save to our recipe book', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Open Test family bowl', exact: true })
    .waitFor()
  // Search among many stores, including shops outside the initial suggestions.
  await page.evaluate(() => {
    const key = 'family-shopping-prototype-v1'
    const saved = JSON.parse(localStorage.getItem(key))
    saved.stores.push(
      ...Array.from({ length: 80 }, (_, i) => ({
        id: `market-${i}`,
        name: `Family Market ${String(i).padStart(3, '0')}`,
        location: i === 79 ? 'Harbor district' : 'City center',
        order: [...saved.stores[0].order],
      })),
    )
    localStorage.setItem(key, JSON.stringify(saved))
  })
  await page.goto(baseUrl)
  await settle(page)
  const shop = page.getByRole('combobox', { name: 'Shopping at', exact: true })
  await shop.click()
  assert.equal(await page.getByRole('option').count(), 12)
  await shop.fill('Harbor')
  assert.equal(await page.getByRole('option').count(), 1)
  await shop.press('ArrowDown')
  await shop.press('Enter')
  assert.equal(await shop.inputValue(), 'Family Market 079')
  await shop.fill('No such shop')
  await page.getByText('No matching shops.', { exact: true }).waitFor()
  await shop.press('ArrowDown')
  assert.equal(await shop.getAttribute('aria-activedescendant'), null)
  await shop.press('Escape')
  assert.equal(await shop.inputValue(), 'Family Market 079')
  await page.reload()
  await settle(page)
  assert.equal(await shop.inputValue(), 'Family Market 079')
  await page.getByRole('button', { name: 'Choose a shop' }).click()
  await page.getByRole('listbox', { name: 'Configured shops' }).waitFor()
  await shop.fill('Prisma')
  await page.getByRole('option', { name: /Prisma/ }).click()
  await page.goto(`${baseUrl}/recipes`)
  await page
    .getByRole('button', { name: 'Open Test family bowl', exact: true })
    .waitFor()
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    for (const path of ['/', '/week', '/recipes', '/settings']) {
      await page.goto(`${baseUrl}${path}`)
      await settle(page)
      const sizes = await page.evaluate(() => ({
        content: document.documentElement.scrollWidth,
        viewport: innerWidth,
      }))
      assert.ok(
        sizes.content <= sizes.viewport,
        `${path} overflows at ${width}px: ${JSON.stringify(sizes)}`,
      )
      assert.equal(await page.locator('h1').count(), 1)
      assert.equal(
        await page
          .locator('img')
          .evaluateAll((imgs) => imgs.filter((i) => !i.naturalWidth).length),
        0,
        `${path} has a missing image`,
      )
    }
  }
  // Start a clean plan and exercise its automatic shopping behavior across tabs.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => {
    const key = 'family-shopping-prototype-v1'
    const saved = JSON.parse(localStorage.getItem(key))
    localStorage.setItem(
      key,
      JSON.stringify({ ...saved, items: [], plan: {}, planCoverage: {} }),
    )
  })
  await page.goto(`${baseUrl}/week`)
  await settle(page)
  await page.getByRole('button', { name: 'Next week', exact: true }).click()
  await page
    .getByRole('button', { name: 'Plan Monday lunch', exact: true })
    .click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Green goddess pasta/ })
    .click()
  await otherTab.goto(baseUrl)
  await settle(otherTab)
  const automaticPasta = otherTab.getByRole('button', {
    name: 'Check Pasta',
    exact: true,
  })
  assert.match(await automaticPasta.innerText(), /400 g[\s\S]*Meal plan/)
  await otherTab.reload()
  await settle(otherTab)
  assert.match(await automaticPasta.innerText(), /400 g/)
  await automaticPasta.click()
  await otherTab
    .getByRole('button', { name: 'Restore Pasta', exact: true })
    .waitFor()
  await otherTab.reload()
  await settle(otherTab)
  assert.equal(await automaticPasta.count(), 0)
  await page.getByRole('button', { name: /^Change Monday lunch:/ }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Cozy tomato soup/ })
    .click()
  await otherTab
    .getByRole('button', { name: 'Check Chopped tomatoes', exact: true })
    .waitFor()
  await otherTab
    .getByRole('button', { name: 'Check Spinach', exact: true })
    .waitFor({ state: 'hidden' })
  await page
    .getByRole('button', { name: 'Plan Tuesday lunch', exact: true })
    .click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Green goddess pasta/ })
    .click()
  await automaticPasta.waitFor()
  assert.match(await automaticPasta.innerText(), /400 g/)
  await otherTab
    .getByRole('button', { name: 'Restore Pasta', exact: true })
    .waitFor({ state: 'hidden' })
  await hold(otherTab, automaticPasta)
  await otherTab
    .getByRole('spinbutton', { name: 'Quantity', exact: true })
    .fill('100')
  await otherTab
    .getByRole('button', { name: 'Save details', exact: true })
    .click()
  assert.match(await automaticPasta.innerText(), /100 g/)
  assert.doesNotMatch(await automaticPasta.innerText(), /Meal plan/)
  assert.deepEqual(errors, [], 'Browser runtime errors')
  console.log(
    'UI checks passed: check/restore, long-press and keyboard edits, product and large-shop autocomplete, custom items, persistence, tab updates, store sorting, ingredient merging, automatic meal ingredients, week suggestions, stores, recipe entry, and responsive layouts.',
  )
} finally {
  await browser.close()
}
