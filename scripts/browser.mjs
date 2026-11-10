import { chromium } from 'playwright'

export const baseUrl = process.env.LITTLECUPBOARD_URL ?? 'http://127.0.0.1:3100'
export async function launchBrowser() {
  return chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox'],
    headless: true,
  })
}
export async function settle(page) {
  if (!page.url().startsWith('file:'))
    await page.locator('[data-app-ready="true"]').waitFor()
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() =>
    [...document.images].every((img) => {
      if (img.complete) return true
      // Offscreen lazy images deliberately wait until scrolled into view.
      const bounds = img.getBoundingClientRect()
      return (
        img.loading === 'lazy' &&
        (bounds.bottom < 0 || bounds.top > window.innerHeight)
      )
    }),
  )
  await page.waitForTimeout(300)
}
