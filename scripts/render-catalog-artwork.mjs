import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { catalog } from '../src/lib/data.ts'
import { catalogArtworkAliases } from '../src/lib/catalog-artwork.ts'
import { launchBrowser } from './browser.mjs'

const browser = await launchBrowser()
try {
  const page = await browser.newPage()
  const products = await Promise.all(
    [
      ...catalog,
      ...Object.entries(catalogArtworkAliases).map(([name, image]) => ({
        name,
        image,
      })),
    ].map(async (product) => ({
      name: product.name,
      image: `data:${product.image.endsWith('.svg') ? 'image/svg+xml' : 'image/webp'};base64,${(await readFile('public' + product.image)).toString('base64')}`,
      raster: product.image.endsWith('.webp'),
    })),
  )
  const result = await page.evaluate(async (products) => {
    const preview = document.createElement('canvas')
    preview.width = 1120
    preview.height = Math.ceil(products.length / 8) * 88
    const c = preview.getContext('2d')
    c.fillStyle = '#f8f6ee'
    c.fillRect(0, 0, preview.width, preview.height)
    const stats = []
    for (const [index, product] of products.entries()) {
      const image = new Image()
      image.src = product.image
      await image.decode()
      if (product.raster && (image.width !== 256 || image.height !== 256))
        throw new Error(`${product.name} is not a 256px icon`)
      const x = (index % 8) * 140,
        y = Math.floor(index / 8) * 88
      c.fillStyle = index % 2 ? '#e9eddb' : '#f3e8d6'
      c.fillRect(x + 43, y + 4, 54, 54)
      c.drawImage(image, x + 46, y + 7, 48, 48)
      c.fillStyle = '#1e4938'
      c.font = '12px sans-serif'
      c.textAlign = 'center'
      c.fillText(product.name, x + 70, y + 76, 134)
      if (product.raster) {
        const check = document.createElement('canvas')
        check.width = check.height = 256
        const cc = check.getContext('2d')
        cc.drawImage(image, 0, 0)
        const rgba = cc.getImageData(0, 0, 256, 256).data
        let clear = 0,
          solid = 0,
          border = 0
        for (let y = 0; y < 256; y++)
          for (let x = 0; x < 256; x++) {
            const alpha = rgba[(y * 256 + x) * 4 + 3]
            if (alpha === 0) clear++
            if (alpha > 240) solid++
            if ((x < 4 || y < 4 || x >= 252 || y >= 252) && alpha) border++
          }
        if (clear < 5000 || solid < 1000 || border)
          throw new Error(`Invalid alpha/padding: ${product.name}`)
        stats.push({ name: product.name, clear, solid })
      }
    }
    // Readable sections are easier to inspect than one very tall sheet.
    const pages = []
    for (let y = 0; y < preview.height; y += 880) {
      const canvas = document.createElement('canvas')
      canvas.width = preview.width
      canvas.height = Math.min(880, preview.height - y)
      canvas.getContext('2d').drawImage(preview, 0, -y)
      pages.push(canvas.toDataURL('image/png').split(',')[1])
    }
    return {
      pages,
      preview: preview.toDataURL('image/png').split(',')[1],
      stats,
    }
  }, products)
  assert.equal(
    products.length,
    catalog.length + Object.keys(catalogArtworkAliases).length,
  )
  if (!process.argv.includes('--check')) {
    await mkdir('test-results/icon-audit', { recursive: true })
    for (const [i, page] of result.pages.entries())
      await writeFile(
        `test-results/icon-audit/catalog-${i + 1}.png`,
        Buffer.from(page, 'base64'),
      )
    await writeFile(
      'docs/artwork/catalog-preview.png',
      Buffer.from(result.preview, 'base64'),
    )
  }
  console.log(
    `Reviewed asset coverage for ${products.length} products; ${result.stats.length} assignments have transparent 256px raster icons.`,
  )
} finally {
  await browser.close()
}
