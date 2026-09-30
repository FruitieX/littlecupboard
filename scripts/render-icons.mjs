import { readFile, writeFile } from 'node:fs/promises'
import { launchBrowser } from './browser.mjs'
const svg = await readFile('public/icon.svg', 'utf8')
const browser = await launchBrowser()
try {
  const page = await browser.newPage()
  for (const size of [192, 512]) {
    const png = await page.evaluate(
      async ({ svg, size }) => {
        const image = new Image()
        image.src = 'data:image/svg+xml;base64,' + btoa(svg)
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        canvas.getContext('2d').drawImage(image, 0, 0, size, size)
        return canvas.toDataURL('image/png').split(',')[1]
      },
      { svg, size },
    )
    await writeFile(`public/icon-${size}.png`, Buffer.from(png, 'base64'))
  }
} finally {
  await browser.close()
}
