// Turn organizations into folders, then leave nothing but a personal vault.
//
//   BW_SESSION=... node scripts/flatten-orgs.mjs            # plan only
//   BW_SESSION=... node scripts/flatten-orgs.mjs --apply
//   BW_SESSION=... node scripts/flatten-orgs.mjs --apply --collections
//
// This has to run through a client. An organization's ciphers are encrypted
// with the organization's key and a personal one with the account key, so
// moving an item means re-encrypting it -- and the server holds neither key.
// `bw` holds both, which is why the work happens here rather than in SQL.
//
// This only copies. The originals are removed later, server-side, when the
// organization tables are dropped -- which is both the point of the exercise
// and the only way it works: Bitwarden clients refuse to delete an
// organization's ciphers on the owner's behalf, and the server route for it
// deliberately only touches personal items.
//
// Re-running is safe. An item already copied into its folder is skipped, so an
// interrupted run resumes instead of duplicating.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const apply = process.argv.includes('--apply')
const useCollections = process.argv.includes('--collections')
if (!process.env.BW_SESSION) throw new Error('BW_SESSION is required; run `bw unlock --raw` first')

// Spawn the binary directly. Through npx this is a process launch per call,
// and a vault of a few hundred items makes hundreds of calls.
const binary = fileURLToPath(new URL('../node_modules/.bin/bw', import.meta.url))
const runner = existsSync(binary) ? [binary, []] : ['npx', ['--no-install', 'bw']]

// A few hundred calls over a flaky link will meet a dropped connection. Retry
// those; anything that is not a network error fails immediately.
const bw = (args, input) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return execFileSync(runner[0], [...runner[1], ...args], {
        input,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        env: process.env,
      })
    } catch (e) {
      const transient = /FetchError|ECONNRESET|ETIMEDOUT|ENETUNREACH|socket hang up/.test(
        String(e.stderr ?? e.message),
      )
      if (!transient || attempt >= 5) throw e
      execFileSync('sleep', [String(attempt * 2)])
    }
  }
}

const json = (args) => JSON.parse(bw(args))
const encode = (value) => bw(['encode'], JSON.stringify(value)).trim()

bw(['sync'])

const orgs = new Map(json(['list', 'organizations']).map((o) => [o.id, o.name]))
const collections = new Map(json(['list', 'collections']).map((c) => [c.id, c.name]))
const items = json(['list', 'items'])
// `bw list items` hides the trash. Dropping the organizations would destroy
// trashed shared items along with everything else, so they are carried across
// too and put back in the personal trash, where they can be reviewed and
// emptied on purpose rather than lost as a side effect.
const trashed = json(['list', 'items', '--trash'])
const shared = [...items, ...trashed.map((t) => ({ ...t, fromTrash: true }))].filter(
  (i) => i.organizationId,
)

if (shared.length === 0) {
  console.log('Nothing to flatten: no organization items in this vault.')
  process.exit(0)
}

/** Where an item lands. A folder holds one item; a collection can hold many. */
function folderFor(item) {
  const org = orgs.get(item.organizationId) ?? 'Organization'
  if (!useCollections) return org
  const [first] = (item.collectionIds ?? [])
    .map((id) => collections.get(id))
    .filter(Boolean)
    .sort()
  return first ? `${org}/${first}` : org
}

const plan = new Map()
for (const item of shared) {
  const name = folderFor(item)
  if (!plan.has(name)) plan.set(name, [])
  plan.get(name).push(item)
}

const inTrash = shared.filter((i) => i.fromTrash).length
console.log(
  `${shared.length} shared item(s) across ${orgs.size} organization(s)` +
    (inTrash ? ` -- ${inTrash} of them in the trash, which stay in the trash` : '') +
    '\n',
)
for (const [name, group] of [...plan].sort()) {
  console.log(`  ${String(group.length).padStart(3)} -> ${name}`)
}

const ambiguous = shared.filter((i) => (i.collectionIds ?? []).length > 1)
if (ambiguous.length > 0) {
  console.log(`\n${ambiguous.length} item(s) are in more than one collection and can only`)
  console.log('go in one folder. They keep the alphabetically first:')
  for (const i of ambiguous) console.log(`  - ${i.name}`)
}

if (!apply) {
  console.log('\nPlan only. Re-run with --apply to carry it out.')
  process.exit(0)
}

// Reuse a folder of the same name rather than making a second one.
const folders = new Map(
  json(['list', 'folders'])
    .filter((f) => f.id)
    .map((f) => [f.name, f.id]),
)

const personal = [...items, ...trashed].filter((i) => !i.organizationId)
let copied = 0
let skipped = 0

for (const [name, group] of [...plan].sort()) {
  let folderId = folders.get(name)
  if (!folderId) {
    folderId = json(['create', 'folder', encode({ name })]).id
    folders.set(name, folderId)
    console.log(`folder: ${name}`)
  }

  for (const item of group) {
    const existing = personal.find((p) => p.name === item.name && p.folderId === folderId)
    if (existing) {
      // An interrupted run can leave a trashed item's copy created but still
      // live. Finish the job rather than skipping it half done.
      if (item.fromTrash && !existing.deletedDate) bw(['delete', 'item', existing.id])
      skipped++
      continue
    }
    const {
      id,
      organizationId,
      collectionIds,
      revisionDate,
      creationDate,
      deletedDate,
      fromTrash,
      ...rest
    } = item
    const created = json(['create', 'item', encode({ ...rest, folderId })])

    // Read it back. A copy that does not decrypt is worse than no copy, because
    // the original is about to be dropped.
    const check = json(['get', 'item', created.id])
    if (check.name !== item.name) throw new Error(`copy of ${item.name} did not read back`)

    // Soft delete: this is the trash, not a purge.
    if (fromTrash) bw(['delete', 'item', created.id])
    copied++
  }
  console.log(`  ${name}: ${group.length} item(s)`)
}

bw(['sync'])
const liveAfter = json(['list', 'items'])
const trashAfter = json(['list', 'items', '--trash'])
const count = (list, shared) => list.filter((i) => Boolean(i.organizationId) === shared).length

console.log(`\nCopied ${copied}${skipped ? `, skipped ${skipped} already present` : ''}.`)
console.log(`Personal: ${count(liveAfter, false)} live, ${count(trashAfter, false)} in trash.`)
console.log(
  `Organization originals still present: ${count(liveAfter, true)} live, ${count(trashAfter, true)} in trash.`,
)
console.log('\nEvery shared item now has a personal copy. The originals go when the')
console.log('organization tables are dropped -- run that only once this looks right.')
