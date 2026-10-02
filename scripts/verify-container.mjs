import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const image =
  process.env.LITTLECUPBOARD_TEST_IMAGE ??
  'ghcr.io/fruitiex/littlecupboard:main'
const suffix = randomUUID().slice(0, 8)
const volume = `littlecupboard-check-${suffix}`
const primary = `littlecupboard-check-${suffix}`
const restored = `${primary}-restored`
const containers = []
const setupToken = randomBytes(32).toString('hex')
const secretKey = randomBytes(32).toString('hex')
function docker(...args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}
function start(name, dataDir = '/data') {
  containers.push(name)
  docker(
    'run',
    '-d',
    '--name',
    name,
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=128m',
    '-p',
    '127.0.0.1::8080',
    '-v',
    `${volume}:/data`,
    '-e',
    name === primary ? 'FORKBASKET_SETUP_TOKEN' : 'LITTLECUPBOARD_SETUP_TOKEN',
    '-e',
    name === primary ? 'FORKBASKET_SECRET_KEY' : 'LITTLECUPBOARD_SECRET_KEY',
    '-e',
    `LITTLECUPBOARD_DATA_DIR=${dataDir}`,
    '-e',
    'LITTLECUPBOARD_ORIGIN=http://localhost:8080',
    image,
  )
  const port = JSON.parse(docker('inspect', name))[0].NetworkSettings.Ports[
    '8080/tcp'
  ][0].HostPort
  return `http://127.0.0.1:${port}`
}
async function ready(origin) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(origin + '/api/ready')).ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Container did not become ready')
}
async function api(origin, path, body, cookie) {
  const response = await fetch(origin + '/api' + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-LittleCupboard-Request': '1',
      Origin: 'http://localhost:8080',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  assert.ok(response.ok, `${path} failed (${response.status})`)
  return {
    body: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0],
  }
}
process.env.FORKBASKET_SETUP_TOKEN = setupToken
process.env.FORKBASKET_SECRET_KEY = secretKey
process.env.LITTLECUPBOARD_SETUP_TOKEN = setupToken
process.env.LITTLECUPBOARD_SECRET_KEY = secretKey
try {
  docker('volume', 'create', volume)
  let origin = start(primary)
  await ready(origin)
  assert.equal(docker('exec', primary, 'id', '-u'), '10001')
  for (const path of [
    '/',
    '/week',
    '/recipes',
    '/settings',
    '/settings/stores',
    '/settings/groups',
    '/settings/items',
    '/settings/recipes',
    '/manifest.webmanifest',
    '/sw.js',
  ])
    assert.equal((await fetch(origin + path)).status, 200, path)
  assert.equal((await fetch(origin + '/api/unknown')).status, 404)
  assert.equal((await fetch(origin + '/api/state')).status, 401)
  const { cookie } = await api(origin, '/auth/setup', {
    setupToken,
    email: 'container@example.test',
    name: 'Container test',
    password: 'a temporary container test password',
    householdName: 'Container test',
    timeZone: 'Europe/Helsinki',
    samples: true,
  })
  await api(
    origin,
    '/operations',
    {
      id: randomUUID(),
      operation: {
        type: 'addItem',
        productId: 'apples',
        quantity: 3,
        unit: 'pc',
        note: 'Crisp',
        accumulate: true,
      },
    },
    cookie,
  )
  const sourceBody = new FormData()
  sourceBody.append(
    'image',
    new Blob([readFileSync('public/images/pasta.jpg')], { type: 'image/jpeg' }),
    'Source recipe.jpg',
  )
  const sourceResponse = await fetch(origin + '/api/images?source=true', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: 'http://localhost:8080',
      'X-LittleCupboard-Request': '1',
    },
    body: sourceBody,
  })
  assert.equal(sourceResponse.status, 200)
  const { url: sourceUrl } = await sourceResponse.json()
  const recipe = (await api(origin, '/state', undefined, cookie)).body.state
    .recipeBook[0]
  const recipeWithSource = {
    ...recipe,
    sourceImages: [{ url: sourceUrl, name: 'Source recipe.jpg' }],
  }
  await api(
    origin,
    '/operations',
    {
      id: randomUUID(),
      operation: {
        type: 'patch',
        label: 'Keep recipe source',
        changes: [
          {
            collection: 'recipeBook',
            key: recipe.id,
            field: null,
            before: recipe,
            after: recipeWithSource,
          },
        ],
      },
    },
    cookie,
  )
  const initialRate = { quantity: 3, unit: 'pc', days: 7 }
  await api(
    origin,
    '/operations',
    {
      id: randomUUID(),
      operation: {
        type: 'patch',
        label: 'Set consumption',
        changes: [
          {
            collection: 'consumptionRates',
            key: 'apples',
            field: null,
            before: null,
            after: initialRate,
          },
        ],
      },
    },
    cookie,
  )
  await api(
    origin,
    '/operations',
    {
      id: randomUUID(),
      operation: {
        type: 'observePantry',
        productId: 'rice',
        quantity: 1,
        unit: 'kg',
        amounts: [{ quantity: 1, unit: 'kg' }],
        expiresAt: null,
        note: 'Backed up pantry',
      },
    },
    cookie,
  )
  docker(
    'exec',
    primary,
    'littlecupboard-api',
    '--backup',
    '/data/smoke-backup.sqlite3',
  )
  assert.equal(
    docker('exec', primary, 'stat', '-c', '%a', '/data/smoke-backup.sqlite3'),
    '600',
  )
  assert.throws(
    () =>
      docker(
        'exec',
        primary,
        'littlecupboard-api',
        '--backup',
        '/data/smoke-backup.sqlite3',
      ),
    'backup must refuse overwrites',
  )
  docker('exec', primary, 'mkdir', '/data/restore')
  docker(
    'exec',
    primary,
    'cp',
    '/data/smoke-backup.sqlite3',
    '/data/restore/forkbasket.sqlite3',
  )
  await api(
    origin,
    '/operations',
    {
      id: randomUUID(),
      operation: {
        type: 'addItem',
        productId: 'apples',
        quantity: 2,
        unit: 'pc',
        note: '',
        accumulate: true,
      },
    },
    cookie,
  )
  await api(
    origin,
    '/operations',
    {
      id: randomUUID(),
      operation: {
        type: 'patch',
        label: 'Change consumption',
        changes: [
          {
            collection: 'consumptionRates',
            key: 'apples',
            field: null,
            before: initialRate,
            after: { quantity: 6, unit: 'pc', days: 3 },
          },
        ],
      },
    },
    cookie,
  )
  await api(
    origin,
    '/operations',
    {
      id: randomUUID(),
      operation: {
        type: 'observePantry',
        productId: 'rice',
        quantity: 500,
        unit: 'g',
        expiresAt: null,
        note: 'After backup',
      },
    },
    cookie,
  )
  docker('restart', primary)
  origin = `http://127.0.0.1:${JSON.parse(docker('inspect', primary))[0].NetworkSettings.Ports['8080/tcp'][0].HostPort}`
  await ready(origin)
  assert.equal(
    (await api(origin, '/state', undefined, cookie)).body.state.items.find(
      (item) => item.id === 'apples',
    ).quantity,
    5,
  )
  const restarted = (await api(origin, '/state', undefined, cookie)).body.state
  assert.deepEqual(
    restarted.recipeBook.find((value) => value.id === recipe.id).sourceImages,
    recipeWithSource.sourceImages,
  )
  assert.equal(
    (await fetch(origin + sourceUrl, { headers: { Cookie: cookie } })).status,
    200,
  )
  assert.equal((await fetch(origin + sourceUrl)).status, 401)
  assert.deepEqual(restarted.consumptionRates.apples, {
    quantity: 6,
    unit: 'pc',
    days: 3,
  })
  assert.equal(restarted.pantry.rice.amounts[0].quantity, 500)
  const restoredOrigin = start(restored, '/data/restore')
  await ready(restoredOrigin)
  assert.equal(
    (
      await api(restoredOrigin, '/state', undefined, cookie)
    ).body.state.items.find((item) => item.id === 'apples').quantity,
    3,
  )
  const recovered = (await api(restoredOrigin, '/state', undefined, cookie))
    .body.state
  assert.deepEqual(recovered.consumptionRates.apples, initialRate)
  assert.equal(recovered.pantry.rice.amounts[0].quantity, 1000)
  assert.equal(recovered.pantry.rice.note, 'Backed up pantry')
  assert.deepEqual(
    recovered.recipeBook.find((value) => value.id === recipe.id).sourceImages,
    recipeWithSource.sourceImages,
  )
  assert.equal(
    (await fetch(restoredOrigin + sourceUrl, { headers: { Cookie: cookie } }))
      .status,
    200,
  )
  const householdBackup = (
    await api(restoredOrigin, '/backup', undefined, cookie)
  ).body
  assert.ok(
    householdBackup.images.some(
      (image) =>
        image.id === sourceUrl.split('/').at(-1) && image.source === true,
    ),
  )
  console.log(
    'Container passed: non-root/read-only runtime, SPA routes, persistent accounts/shopping, restart, private online backup and point-in-time restoration.',
  )
} finally {
  for (const name of containers.reverse()) {
    try {
      docker('rm', '-f', name)
    } catch {}
  }
  try {
    docker('volume', 'rm', volume)
  } catch {}
}
