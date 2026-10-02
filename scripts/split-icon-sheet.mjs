// Crop a reviewed 4x4 AI sprite sheet; preserve alpha and store 256px WebP icons.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { launchBrowser } from './browser.mjs'

const [batchNumber, input] = process.argv.slice(2)
if (!batchNumber || !input)
  throw new Error('Usage: node scripts/split-icon-sheet.mjs BATCH INPUT.png')
const batches = JSON.parse(
  await readFile('docs/artwork/catalog-batches.json', 'utf8'),
)
const batch = batches[Number(batchNumber) - 1]
if (batch?.length !== 16 && batch?.length !== 1)
  throw new Error(
    'Specify sixteen sheet subjects or one individual replacement.',
  )
const bytes = (await readFile(input)).toString('base64')
const browser = await launchBrowser()
try {
  const page = await browser.newPage()
  const result = await page.evaluate(
    async ({ bytes, batch }) => {
      const sheet = new Image()
      sheet.src = `data:image/png;base64,${bytes}`
      await sheet.decode()
      if (sheet.width !== sheet.height)
        throw new Error('Expected a square 4x4 sheet.')
      // Assign connected foreground shapes to their cell by their center. This
      // extracts each sprite even when it slightly crosses the nominal grid,
      // without picking up the cap/leaf of a neighboring sprite in the gutter.
      const width = sheet.width,
        grid = batch.length === 1 ? 1 : 4,
        cell = width / grid
      const source = document.createElement('canvas')
      source.width = source.height = width
      const sc = source.getContext('2d')
      sc.drawImage(sheet, 0, 0)
      const pixels = sc.getImageData(0, 0, width, width).data
      const visited = new Uint8Array(width * width)
      const owners = new Uint8Array(width * width)
      const queue = new Uint32Array(width * width)
      for (let start = 0; start < visited.length; start++) {
        if (visited[start] || pixels[start * 4 + 3] <= 32) continue
        let tail = 1,
          head = 0,
          sumX = 0,
          sumY = 0
        queue[0] = start
        visited[start] = 1
        while (head < tail) {
          const pos = queue[head++],
            x = pos % width,
            y = Math.floor(pos / width)
          sumX += x
          sumY += y
          for (const next of [
            x > 0 ? pos - 1 : -1,
            x < width - 1 ? pos + 1 : -1,
            y > 0 ? pos - width : -1,
            y < width - 1 ? pos + width : -1,
          ]) {
            if (next < 0 || visited[next] || pixels[next * 4 + 3] <= 32)
              continue
            visited[next] = 1
            queue[tail++] = next
          }
        }
        if (tail < 12) continue
        const owner =
          Math.floor(sumY / tail / cell) * grid +
          Math.floor(sumX / tail / cell) +
          1
        for (let j = 0; j < tail; j++) owners[queue[j]] = owner
      }
      const preview = document.createElement('canvas')
      preview.width = 800
      preview.height = 480
      const pc = preview.getContext('2d')
      pc.fillStyle = '#f5f0e6'
      pc.fillRect(0, 0, 800, 480)
      const icons = batch.map(([key], i) => {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 256
        const context = canvas.getContext('2d')
        const gutter = Math.ceil(cell * 0.05)
        const side = Math.ceil(cell + gutter * 2)
        const sprite = document.createElement('canvas')
        sprite.width = sprite.height = side
        const spriteContext = sprite.getContext('2d')
        const extracted = spriteContext.createImageData(side, side)
        const startX = Math.floor((i % grid) * cell - gutter)
        const startY = Math.floor(Math.floor(i / grid) * cell - gutter)
        for (let y = 0; y < side; y++)
          for (let x = 0; x < side; x++) {
            const sx = startX + x,
              sy = startY + y
            if (sx < 0 || sy < 0 || sx >= width || sy >= width) continue
            const pos = sy * width + sx
            let belongs = owners[pos] === i + 1
            // Retain original soft edge pixels immediately next to this sprite.
            if (!owners[pos] && pixels[pos * 4 + 3])
              for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) {
                  if (
                    sx + dx >= 0 &&
                    sy + dy >= 0 &&
                    sx + dx < width &&
                    sy + dy < width &&
                    owners[pos + dy * width + dx] === i + 1
                  )
                    belongs = true
                }
            if (belongs)
              extracted.data.set(
                pixels.subarray(pos * 4, pos * 4 + 4),
                (y * side + x) * 4,
              )
          }
        spriteContext.putImageData(extracted, 0, 0)
        context.drawImage(sprite, 0, 0, side, side, 8, 8, 240, 240)
        const rgba = context.getImageData(0, 0, 256, 256).data
        let transparent = 0,
          opaque = 0,
          edgeOpaque = 0
        for (let y = 0; y < 256; y++)
          for (let x = 0; x < 256; x++) {
            const alpha = rgba[(y * 256 + x) * 4 + 3]
            if (alpha === 0) transparent++
            if (alpha > 240) opaque++
            if ((x < 4 || y < 4 || x >= 252 || y >= 252) && alpha > 240)
              edgeOpaque++
          }
        if (transparent < 5000 || opaque < 1000)
          throw new Error(`Missing transparency or subject: ${key}`)
        const x = (i % 4) * 200,
          y = Math.floor(i / 4) * 120
        pc.drawImage(canvas, x + 14, y + 10, 80, 80)
        pc.fillStyle = '#dde8c8'
        pc.fillRect(x + 113, y + 20, 66, 66)
        pc.drawImage(canvas, x + 122, y + 28, 48, 48)
        pc.fillStyle = '#1e4938'
        pc.font = '13px sans-serif'
        pc.fillText(key, x + 14, y + 106, 178)
        return {
          key,
          data: canvas.toDataURL('image/webp', 0.92).split(',')[1],
          transparent,
          opaque,
          edgeOpaque,
        }
      })
      return {
        icons,
        preview: preview.toDataURL('image/png').split(',')[1],
        width: sheet.width,
      }
    },
    { bytes, batch },
  )
  await mkdir('public/images/catalog/generated', { recursive: true })
  await mkdir('test-results/icon-audit', { recursive: true })
  for (const { key, data } of result.icons)
    if (
      batch.length === 1 ||
      batch.some(([id, , products]) => id === key && products)
    )
      await writeFile(
        `public/images/catalog/generated/${key}.webp`,
        Buffer.from(data, 'base64'),
      )
  await writeFile(
    `test-results/icon-audit/batch-${batchNumber}.png`,
    Buffer.from(result.preview, 'base64'),
  )
  console.log(
    JSON.stringify({
      width: result.width,
      icons: result.icons.map(({ data, ...icon }) => icon),
    }),
  )
} finally {
  await browser.close()
}
