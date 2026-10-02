// Synthetic native capability check; never changes the production pairing file.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { launchBrowser } from './browser.mjs'

assert.equal(
  process.env.LITTLECUPBOARD_HERMES_LIVE,
  '1',
  'Set LITTLECUPBOARD_HERMES_LIVE=1 to make two personal subscription calls',
)
const folder = resolve('test-results/media-live')
await mkdir(folder, { recursive: true, mode: 0o700 })
const browser = await launchBrowser()
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 950 } })
  await page.setContent(
    `<main style="font:24px/1.7 sans-serif;padding:48px;background:#fff;color:#111"><h1>Pear yogurt bowls</h1><p>Serves 4 · 10 minutes</p><h2>Ingredients</h2><ul><li>600 g plain yogurt</li><li>4 pears</li><li>80 g rolled oats</li></ul><h2>Method</h2><ol><li>Wash and dice the pears.</li><li>Divide the yogurt between four bowls.</li><li>Top with pears and oats, then serve.</li></ol></main>`,
  )
  await page.screenshot({ path: join(folder, 'synthetic-recipe.png') })
} finally {
  await browser.close()
}
const env = {
  ...process.env,
  HERMES_HOME: join(homedir(), '.hermes/profiles/littlecupboard'),
}
const command = JSON.parse(
  execFileSync(
    process.env.LITTLECUPBOARD_HERMES_BINARY || 'hermes',
    ['--print-runtime-command', '--module', 'runpy'],
    { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ),
)
const entry = "runpy.run_module('runpy', run_name='__main__', alter_sys=True)"
assert.ok(
  command[1] === '-I' && command[2] === '-c' && command[3].endsWith(entry),
)
command[3] =
  command[3].slice(0, -entry.length) +
  "runpy.run_path(sys.argv.pop(1), run_name='__main__')"
command.push(resolve('scripts/verify-media-live.py'), folder)
const child = spawn(command[0], command.slice(1), {
  env,
  stdio: ['ignore', 'inherit', 'ignore'],
})
const timer = setTimeout(() => child.kill('SIGTERM'), 6 * 60_000)
try {
  assert.equal(
    await new Promise((done) => {
      child.once('error', () => done(1))
      child.once('exit', (code) => done(code ?? 1))
    }),
    0,
    'Personal media capability check failed',
  )
} finally {
  clearTimeout(timer)
}
