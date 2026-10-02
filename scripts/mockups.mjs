import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { launchBrowser, settle } from './browser.mjs'
const child = spawn(process.execPath, ['scripts/verify-production.mjs'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    LITTLECUPBOARD_TEST_PRODUCTION: '1',
    LITTLECUPBOARD_CAPTURE: '1',
  },
})
const code = await new Promise((resolve) => child.once('exit', resolve))
if (code !== 0) process.exit(code ?? 1)
const path = 'mockups/overview.html'
let html = await readFile(path, 'utf8')
html = html
  .replace('MOBILE CONCEPT · 01', 'FAMILY KITCHEN · 01')
  .replace(
    'Actual screens from the interactive prototype',
    'Actual screens from the production app',
  )
await writeFile(path, html)
const browser = await launchBrowser()
try {
  const page = await browser.newPage({
    viewport: { width: 1480, height: 1220 },
  })
  await page.goto(`file://${resolve(path)}`)
  await settle(page)
  await page.screenshot({ path: 'mockups/overview.png', fullPage: true })
} finally {
  await browser.close()
}
