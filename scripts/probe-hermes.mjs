// Exercises the installed Hermes image provider; never imports its credentials.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const options = process.argv.slice(2)
const profileIndex = options.indexOf('--profile')
const profile = profileIndex >= 0 ? options[profileIndex + 1] : undefined
assert.ok(
  profile && /^[a-z0-9][a-z0-9-]*$/.test(profile) && profile !== 'default',
  'Select a dedicated personal profile: node scripts/probe-hermes.mjs --profile littlecupboard [--images]',
)
options.splice(profileIndex, 2)
const args = options
assert.ok(
  args.every((arg) => arg === '--images'),
  'Usage: node scripts/probe-hermes.mjs --profile littlecupboard [--images]',
)
const binary = process.env.LITTLECUPBOARD_HERMES_BINARY || 'hermes'
const environment = {
  ...process.env,
  HERMES_HOME: join(homedir(), '.hermes/profiles', profile),
}
// Preserve Hermes's own pinned Python and dependency bootstrap. Do not create a
// second environment or modify the installed Hermes checkout or provider settings.
const command = JSON.parse(
  execFileSync(binary, ['--print-runtime-command', '--module', 'runpy'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: environment,
  }),
)
const entry = "runpy.run_module('runpy', run_name='__main__', alter_sys=True)"
assert.ok(
  command[1] === '-I' && command[2] === '-c' && command[3].endsWith(entry),
  'Unrecognized Hermes runtime launcher; inspect its published command before adapting the probe',
)
command[3] =
  command[3].slice(0, -entry.length) +
  "runpy.run_path(sys.argv.pop(1), run_name='__main__')"
command.push(
  fileURLToPath(new URL('./probe-hermes.py', import.meta.url)),
  resolve('test-results/hermes-probe', profile),
  ...args,
)
const child = spawn(command[0], command.slice(1), {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: environment,
})
// Provider diagnostics can contain account details or provider response bodies.
child.stderr.resume()
const lines = createInterface({ input: child.stdout })
let received = false
lines.on('line', (line) => {
  if (!line.startsWith('LITTLECUPBOARD_HERMES_PROBE ')) return
  const report = JSON.parse(line.slice('LITTLECUPBOARD_HERMES_PROBE '.length))
  received = true
  console.log(JSON.stringify(report, null, 2))
})
const timer = setTimeout(
  () => child.kill('SIGTERM'),
  args.includes('--images') ? 16 * 60_000 : 30_000,
)
const stop = () => child.kill('SIGTERM')
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
const code = await new Promise((done) => {
  child.once('error', () => done(1))
  child.once('exit', (code) => done(code ?? 1))
})
clearTimeout(timer)
if (!received) console.error('Hermes probe ended without a sanitized result.')
process.exitCode = code || (received ? 0 : 1)
