// Reproduce the catalog's existing vector artwork as a small raster style sheet.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { launchBrowser } from './browser.mjs'
const icons = await Promise.all(
  ['1f34e', '1f34b', '1f955', '1f966', '1f95b', '1f35e'].map((code) =>
    readFile(`public/images/food/${code}.svg`, 'utf8'),
  ),
)
const browser = await launchBrowser()
try {
  const page = await browser.newPage()
  const png = await page.evaluate(async (icons) => {
    const canvas = document.createElement('canvas')
    canvas.width = 288
    canvas.height = 192
    const context = canvas.getContext('2d')
    for (let i = 0; i < icons.length; i++) {
      const image = new Image()
      image.src = 'data:image/svg+xml;base64,' + btoa(icons[i])
      await image.decode()
      context.drawImage(
        image,
        (i % 3) * 96 + 12,
        Math.floor(i / 3) * 96 + 12,
        72,
        72,
      )
    }
    return canvas.toDataURL('image/png').split(',')[1]
  }, icons)
  await mkdir('backend/assets', { recursive: true })
  await writeFile(
    'backend/assets/item-style-reference.png',
    Buffer.from(png, 'base64'),
  )
} finally {
  await browser.close()
}
