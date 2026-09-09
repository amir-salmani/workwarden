// Post-deploy smoke test: drive a real vault round-trip against a deployed
// Worker, then delete what it created.
//
// This is the check that catches what unit tests cannot -- the Worker, the
// Hyperdrive config and Neon all being wired to each other. Hyperdrive query
// caching was found this way.
//
//   node scripts/smoke.mjs https://workwarden.example.workers.dev
import postgres from 'postgres'

const base = process.argv[2]
if (!base) throw new Error('usage: smoke.mjs <base-url>')

const email = `smoke-${Date.now()}@workwarden.invalid`
const hash = Buffer.from(`smoke-${Date.now()}`).toString('base64')

const step = async (name, fn) => {
  const res = await fn()
  console.log(`${res.ok ? 'ok  ' : 'FAIL'} ${name} -> ${res.status}`)
  if (!res.ok) {
    console.error(await res.text())
    throw new Error(`${name} failed with ${res.status}`)
  }
  return res
}

// A deploy takes a few seconds to reach every edge, so running straight after
// `wrangler deploy` can still hit the previous version. Wait for the route to
// exist rather than reporting a rollout delay as a failure. 404 means old code;
// 400 means the route is there and rejected the empty body.
const ready = async () => {
  const deadline = Date.now() + 120_000
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${base}/api/accounts/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    if (res.status !== 404) {
      console.log(`ok   deployment is live (attempt ${attempt})`)
      return
    }
    if (Date.now() > deadline)
      throw new Error('routes never appeared; deployment did not propagate')
    await new Promise((r) => setTimeout(r, 3000))
  }
}

await step('config', () => fetch(`${base}/api/config`))
await ready()

await step('register', () =>
  fetch(`${base}/api/accounts/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      masterPasswordHash: hash,
      key: '2.smoke-user-key',
      kdf: 0,
      kdfIterations: 600000,
    }),
  }),
)

// Immediately after register on purpose: a cached "user does not exist" read
// used to make this fail. See compat/README.md.
const form = new FormData()
form.append('grant_type', 'password')
form.append('username', email)
form.append('password', hash)
form.append('scope', 'api offline_access')
form.append('deviceIdentifier', 'smoke')
const token = await step('login (immediately after register)', () =>
  fetch(`${base}/identity/connect/token`, { method: 'POST', body: form }),
)
const { access_token } = await token.json()
const auth = { Authorization: `Bearer ${access_token}` }

await step('create cipher', () =>
  fetch(`${base}/api/ciphers`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 1, name: '2.smoke', login: { username: '2.u' } }),
  }),
)

const sync = await step('sync', () => fetch(`${base}/api/sync`, { headers: auth }))
const vault = await sync.json()
if (vault.object !== 'sync') throw new Error(`sync returned object=${vault.object}`)
if (vault.profile?.email !== email) throw new Error('sync returned the wrong profile')
if (vault.ciphers?.length !== 1) throw new Error(`expected 1 cipher, got ${vault.ciphers?.length}`)
console.log('ok   vault round-trip')

if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is required so smoke users can be removed')
const sql = postgres(process.env.DATABASE_URL)
const deleted =
  await sql`delete from users where email like 'smoke-%@workwarden.invalid' returning id`
await sql.end()
console.log(`ok   cleaned up ${deleted.length} smoke user(s)`)
