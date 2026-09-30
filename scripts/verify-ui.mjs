import assert from 'node:assert/strict'
import { launchBrowser, baseUrl, settle } from './browser.mjs'

const browser = await launchBrowser()
const errors = []
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(baseUrl)
  await settle(page)
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
  await page.getByRole('button', { name: 'Edit Avocado', exact: true }).click()
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
  await page.getByLabel('Shopping at', { exact: true }).selectOption('lidl')
  assert.match(
    await page.locator('.shopping-group h2').first().innerText(),
    /Bread & pastries\s+1/,
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
  await page
    .getByRole('button', { name: 'Shop this week', exact: true })
    .click()
  await page.getByRole('status').waitFor()
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
  await page.reload()
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
  assert.deepEqual(errors, [], 'Browser runtime errors')
  console.log(
    'UI checks passed: check/restore, edits, autocomplete, custom items, persistence, tab updates, store sorting, ingredient merging, week suggestions, stores, recipe entry, and responsive layouts.',
  )
} finally {
  await browser.close()
}
