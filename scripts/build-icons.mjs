// Deterministic raster exports from the editable SVG master, using the pinned browser.
import { readFile, writeFile } from 'node:fs/promises'
import { launchBrowser } from './browser.mjs'

const svg = await readFile('public/icon.svg', 'utf8')
const browser = await launchBrowser()
try {
  const page = await browser.newPage()
  for (const size of [192, 512]) {
    const data = await page.evaluate(
      async ({ svg, size }) => {
        const source = new Image()
        source.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
        await source.decode()
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        const context = canvas.getContext('2d')
        // Opaque corners keep Android's maskable icon background continuous.
        context.fillStyle = '#1e4938'
        context.fillRect(0, 0, size, size)
        context.drawImage(source, 0, 0, size, size)
        return canvas.toDataURL('image/png').split(',')[1]
      },
      { svg, size },
    )
    await writeFile(`public/icon-${size}.png`, Buffer.from(data, 'base64'))
  }
} finally {
  await browser.close()
}
