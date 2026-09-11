// Create or delete a Neon branch for a pull request, and print its pooled
// connection string. A branch is a copy-on-write clone, so this is cheap and
// gives each PR a database of its own instead of pointing previews at
// production.
//
//   node scripts/neon-branch.mjs create pr-12   -> prints the connection string
//   node scripts/neon-branch.mjs reset  pr-12   -> fresh copy of production, then as create
//   node scripts/neon-branch.mjs delete pr-12
const [, , action, name] = process.argv
const project = process.env.NEON_PROJECT_ID
const key = process.env.NEON_API_KEY
if (!action || !name) throw new Error('usage: neon-branch.mjs <create|delete> <branch-name>')
if (!project || !key) throw new Error('NEON_PROJECT_ID and NEON_API_KEY are required')

const api = async (path, init = {}) => {
  const res = await fetch(`https://console.neon.tech/api/v2/projects/${project}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok)
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`)
  return res.status === 204 ? undefined : res.json()
}

const find = async () => {
  const { branches } = await api('/branches')
  return branches.find((b) => b.name === name)
}

// A preview reused across pushes keeps whatever migrations ran on it before. A
// PR that later gains an earlier-numbered migration from master then applies
// it on top of a schema that has moved on -- the permissions migration hit
// exactly that. Previews start from production every time instead.
if (action === 'reset') {
  const stale = await find()
  if (stale) {
    await api(`/branches/${stale.id}`, { method: 'DELETE' })
    console.error(`dropped stale branch ${name}`)
    // Neon finishes deleting asynchronously; creating the same name at once
    // can race it.
    for (let i = 0; i < 20 && (await find()); i++) await new Promise((r) => setTimeout(r, 1500))
  }
}

if (action === 'delete') {
  const branch = await find()
  if (!branch) {
    console.error(`branch ${name} does not exist; nothing to delete`)
    process.exit(0)
  }
  await api(`/branches/${branch.id}`, { method: 'DELETE' })
  console.error(`deleted branch ${name}`)
  process.exit(0)
}

// Reused rather than recreated, so pushing again to a PR keeps its database.
let branch = await find()
if (!branch) {
  const created = await api('/branches', {
    method: 'POST',
    body: JSON.stringify({ branch: { name }, endpoints: [{ type: 'read_write' }] }),
  })
  branch = created.branch
  console.error(`created branch ${name}`)
} else {
  console.error(`reusing branch ${name}`)
}

const { uri } = await api(
  `/connection_uri?branch_id=${branch.id}&database_name=${encodeURIComponent(process.env.NEON_DATABASE_NAME ?? 'ww-vw')}&role_name=${encodeURIComponent(process.env.NEON_ROLE ?? 'ww-vw_owner')}&pooled=true`,
)
process.stdout.write(uri)
