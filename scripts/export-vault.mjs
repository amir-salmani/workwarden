// Write one age-encrypted Bitwarden JSON export per user.
//
// FEASIBILITY.md §2.4: an automated encrypted export, in the standard format, to
// somewhere neither Cloudflare nor Neon controls. A database dump would only be
// restorable into workwarden, which is no exit at all -- this file imports into
// a real Bitwarden or Vaultwarden.
//
// Two layers, and neither can be stripped by whoever runs this:
//   1. Every vault field is already ciphertext. The server has never held a key
//      that could decrypt it.
//   2. age public-key encryption on top. CI has the recipient, not the identity,
//      so a compromised workflow can write backups but cannot read one back.
//
// One file per vault, named for the vault and overwritten in place. The old
// naming put the date in the filename, so an untouched vault still produced a
// new file every night -- and age output differs on every run even for
// identical input, so nothing deduplicated it. manifest.json records a digest
// of each export with its timestamp removed, and a vault whose digest has not
// moved is not rewritten. Previous versions live in the backup repository's
// history, which is what a version is for.
//
//   AGE_RECIPIENT=age1... DATABASE_URL=postgres://... node scripts/export-vault.mjs out/
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

const outDir = process.argv[2] ?? 'out'
const recipient = process.env.AGE_RECIPIENT
if (!recipient) throw new Error('AGE_RECIPIENT is required')
if (!recipient.startsWith('age1')) throw new Error('AGE_RECIPIENT must be an age public key')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')

const sql = postgres(process.env.DATABASE_URL)
const rows = await sql`select user_id, email, export::text as body from vault_export order by email`
await sql.end()

mkdirSync(outDir, { recursive: true })
const manifestPath = join(outDir, 'manifest.json')

/** Reads the previous run's digests; a missing or damaged file just means "all new". */
const previous = (() => {
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return {}
  }
})()
const manifest = {}
const now = new Date().toISOString()

// The export carries the moment it was taken, which would make every night's
// digest differ from the last. Everything else in it is the vault.
function digestOf(body) {
  const parsed = JSON.parse(body)
  if (parsed.workwarden) delete parsed.workwarden.exportedAt
  return createHash('sha256').update(JSON.stringify(parsed)).digest('hex')
}

let written = 0
let unchanged = 0

for (const row of rows) {
  const parsed = JSON.parse(row.body)
  // A backup nobody has looked at is a rumour. Assert the shape before shipping.
  if (parsed.encrypted !== true) throw new Error(`${row.email}: export is not marked encrypted`)
  if (!Array.isArray(parsed.items)) throw new Error(`${row.email}: items is not an array`)
  if (!Array.isArray(parsed.folders)) throw new Error(`${row.email}: folders is not an array`)
  for (const item of parsed.items) {
    if (typeof item.name !== 'string' || !item.name.startsWith('2.')) {
      throw new Error(`${row.email}: item ${item.id} has a name that is not an EncString`)
    }
  }

  const digest = digestOf(row.body)
  const file = join(outDir, `${row.user_id}.json.age`)
  manifest[row.user_id] = {
    digest,
    items: parsed.items.length,
    folders: parsed.folders.length,
    updatedAt: previous[row.user_id]?.digest === digest ? previous[row.user_id].updatedAt : now,
  }

  if (previous[row.user_id]?.digest === digest && existsSync(file)) {
    unchanged++
    console.log(`ok   ${row.email}: unchanged since ${manifest[row.user_id].updatedAt}`)
    continue
  }

  execFileSync('age', ['--recipient', recipient, '--output', file], { input: row.body })
  written++
  console.log(
    `ok   ${row.email}: ${parsed.items.length} items, ${parsed.folders.length} folders -> ${file}`,
  )
}

// Rewritten from the vaults that exist now, so a deleted account drops out of
// the manifest. Its last backup file stays: nothing here deletes a backup.
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

if (rows.length === 0) console.log('no users to export')
console.log(`${written} vault(s) written, ${unchanged} unchanged`)
