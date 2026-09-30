import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { launchBrowser, baseUrl, settle } from './browser.mjs'

await mkdir('mockups', { recursive: true })
const browser = await launchBrowser()
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  for (const [name, path] of [
    ['shopping', '/'],
    ['week', '/week'],
    ['recipes', '/recipes'],
    ['settings', '/settings'],
  ]) {
    await page.goto(`${baseUrl}${path}`)
    await settle(page)
    await page.screenshot({ path: `mockups/${name}-mobile.png` })
    await page.screenshot({
      path: `mockups/${name}-mobile-full.png`,
      fullPage: true,
    })
  }
  await page.goto(baseUrl)
  await settle(page)
  await page.getByRole('combobox', { name: 'Shopping at', exact: true }).click()
  await page.getByRole('listbox', { name: 'Configured shops' }).waitFor()
  await page.screenshot({ path: 'mockups/shop-picker-mobile.png' })
  await page.goto(`${baseUrl}/recipes`)
  await page
    .getByRole('button', { name: 'Open Green goddess pasta', exact: true })
    .click()
  await settle(page)
  await page.screenshot({ path: 'mockups/recipe-detail-mobile.png' })
  const desktop = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1.5,
    reducedMotion: 'reduce',
  })
  await desktop.goto(baseUrl)
  await settle(desktop)
  await desktop.screenshot({
    path: 'mockups/shopping-desktop.png',
    fullPage: true,
  })
  const overview = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ForkBasket mobile concepts</title><style>
    @font-face{font-family:DM;src:url('../public/fonts/dm-sans.ttf')}@font-face{font-family:Fraunces;src:url('../public/fonts/fraunces.ttf')}
    *{box-sizing:border-box}body{margin:0;background:#f1f1e7;color:#234d3b;font-family:DM,sans-serif;padding:45px 65px;width:1480px}
    header{display:flex;justify-content:space-between;align-items:flex-start}h1{font:500 48px Fraunces,Georgia,serif;letter-spacing:-1.7px;margin:10px 0}p{color:#88947b;font-size:14px;margin:10px 0}.eyebrow{font-size:11px;letter-spacing:2px;color:#83936c}.pill{padding:10px 16px;border:1px solid #d3ddc3;border-radius:30px;font-size:11px;letter-spacing:1px;margin-top:15px}
    main{display:flex;justify-content:center;gap:50px;margin-top:34px}.concept{width:390px}.label{display:flex;gap:10px;align-items:center;font-size:16px;font-weight:500;margin-bottom:13px}.label span{color:#97a780;font-size:11px}.phone{background:#fbfaf6;border:7px solid #2b4033;border-radius:37px;padding:0;overflow:hidden;box-shadow:0 17px 30px #29412c17;position:relative;height:858px}.phone img{width:100%;display:block;height:100%;object-fit:cover;object-position:top}.caption{font-size:11px;color:#8e9981;line-height:1.6;margin-top:14px}footer{display:flex;justify-content:space-between;border-top:1px solid #dde2d1;margin-top:26px;padding-top:18px;font-size:10px;color:#939d88}
    </style></head><body><header><div><span class="eyebrow">A LITTLE MORE TOGETHER</span><h1>ForkBasket.</h1><p>Your family’s groceries, good recipes, and a delicious week.</p></div><span class="pill">MOBILE CONCEPT · 01</span></header><main>
    <div class="concept"><div class="label"><span>01</span>A happier shopping trip</div><div class="phone"><img src="shopping-mobile.png" alt="Shopping list mobile mockup"></div><p class="caption">Big food tiles, one-tap checking, and a list that follows your store.</p></div>
    <div class="concept"><div class="label"><span>02</span>A little plan for the week</div><div class="phone"><img src="week-mobile.png" alt="Week planner mobile mockup"></div><p class="caption">Plan a lunch and missing ingredients automatically join your shopping list.</p></div>
    <div class="concept"><div class="label"><span>03</span>Good food, worth keeping</div><div class="phone"><img src="recipes-mobile.png" alt="Recipe book mobile mockup"></div><p class="caption">A family recipe book full of the tried, the loved, and the next thing to try.</p></div>
    </main><footer><span>Warm ivory · Forest green · Gentle food colors</span><span>Actual screens from the interactive prototype</span></footer></body></html>`
  await writeFile('mockups/overview.html', overview)
  const board = await browser.newPage({
    viewport: { width: 1480, height: 1220 },
    deviceScaleFactor: 1,
  })
  await board.goto(`file://${resolve('mockups/overview.html')}`)
  await settle(board)
  await board.screenshot({ path: 'mockups/overview.png', fullPage: true })
  console.log(
    'Saved mobile, desktop, recipe-detail, and overview mockups in mockups/.',
  )
} finally {
  await browser.close()
}
