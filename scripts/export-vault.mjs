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
//   AGE_RECIPIENT=age1... DATABASE_URL=postgres://... node scripts/export-vault.mjs out/
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
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
const stamp = new Date().toISOString().slice(0, 10)

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

  const file = join(outDir, `${stamp}-${row.user_id}.json.age`)
  execFileSync('age', ['--recipient', recipient, '--output', file], { input: row.body })
  console.log(
    `ok   ${row.email}: ${parsed.items.length} items, ${parsed.folders.length} folders -> ${file}`,
  )
}

if (rows.length === 0) console.log('no users to export')
console.log(`exported ${rows.length} vault(s)`)
