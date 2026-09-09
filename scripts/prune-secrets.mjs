// Delete any Worker secret that secrets.yml does not manage, over the API.
//
// Not `wrangler secret delete`: it dropped --force, and its confirmation prompt
// falls back to "no" in a non-interactive shell, so the delete would be skipped
// while the step still reported success.
const KEEP = new Set(['AUTH_PEPPER', 'JWT_SECRET'])
const script = process.env.WORKER_NAME ?? 'workwarden'
const account = process.env.CLOUDFLARE_ACCOUNT_ID
const token = process.env.CLOUDFLARE_API_TOKEN
if (!account || !token)
  throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required')

const api = async (path, init = {}) => {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${script}${path}`,
    { ...init, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' } },
  )
  const body = await res.json()
  if (!body.success)
    throw new Error(`${init.method ?? 'GET'} ${path} -> ${JSON.stringify(body.errors)}`)
  return body.result
}

const secrets = await api('/secrets')
const extra = secrets.filter((s) => !KEEP.has(s.name))

for (const s of extra) {
  await api(`/secrets/${encodeURIComponent(s.name)}`, { method: 'DELETE' })
  console.log(`deleted ${s.name}`)
}
console.log(
  extra.length === 0
    ? `nothing to prune (${secrets
        .map((s) => s.name)
        .sort()
        .join(', ')})`
    : `pruned ${extra.length}`,
)
