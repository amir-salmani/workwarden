// Create, update or delete a Hyperdrive config by name. Used to give each pull
// request its own config pointing at its own Neon branch.
//
// Caching is always disabled: a vault cannot serve stale reads, and a cached
// "user does not exist" once broke login right after registration.
//
//   node scripts/hyperdrive.mjs upsert workwarden-pr-12 "postgres://..."  -> prints the id
//   node scripts/hyperdrive.mjs delete workwarden-pr-12
//   node scripts/hyperdrive.mjs check  workwarden-neon                    -> exits 1 if caching is on
const [, , action, name, connectionString] = process.argv
const account = process.env.CLOUDFLARE_ACCOUNT_ID
const token = process.env.CLOUDFLARE_API_TOKEN
if (!action || !name)
  throw new Error('usage: hyperdrive.mjs <upsert|delete> <name> [connection-string]')
if (!account || !token)
  throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required')

const api = async (path, init = {}) => {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/hyperdrive/configs${path}`,
    { ...init, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' } },
  )
  const body = await res.json()
  if (!body.success)
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${JSON.stringify(body.errors)}`)
  return body.result
}

const existing = (await api('')).find((c) => c.name === name)

if (action === 'check') {
  if (!existing) throw new Error(`no Hyperdrive config named ${name}`)
  if (existing.caching?.disabled !== true) {
    throw new Error(
      `caching is enabled on ${name}. Fix with:\n  node scripts/hyperdrive.mjs upsert ${name} "<connection-string>"`,
    )
  }
  console.error(`${name}: caching disabled`)
  process.exit(0)
}

if (action === 'delete') {
  if (!existing) {
    console.error(`no config named ${name}; nothing to delete`)
    process.exit(0)
  }
  await api(`/${existing.id}`, { method: 'DELETE' })
  console.error(`deleted ${name}`)
  process.exit(0)
}

if (!connectionString) throw new Error('upsert needs a connection string')
const url = new URL(connectionString)
const origin = {
  scheme: 'postgres',
  host: url.hostname,
  port: Number(url.port || 5432),
  database: decodeURIComponent(url.pathname.slice(1)),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
}
const payload = { name, origin, caching: { disabled: true } }

const result = existing
  ? await api(`/${existing.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
  : await api('', { method: 'POST', body: JSON.stringify(payload) })

console.error(`${existing ? 'updated' : 'created'} ${name}`)
process.stdout.write(result.id)
