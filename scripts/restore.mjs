// Put a snapshot back into D1.
//
//   node scripts/restore.mjs <snapshot.json.age> <identity-file> [--remote]
//
// Decrypts with the age identity, turns the export into SQL, and applies it
// with `wrangler d1 execute` -- locally by default, remotely with --remote.
// The database must be empty; the Worker must have the same AUTH_PEPPER the
// export was made under, or the password will not verify.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Decrypter } from 'age-encryption'

const [file, identityFile, flag] = process.argv.slice(2)
if (!file || !identityFile) {
  console.error('usage: node scripts/restore.mjs <snapshot.json.age> <identity-file> [--remote]')
  process.exit(2)
}

const decrypter = new Decrypter()
decrypter.addIdentity(
  readFileSync(identityFile, 'utf8')
    .trim()
    .split('\n')
    .filter((l) => l.startsWith('AGE-SECRET-KEY-'))[0],
)
const exp = JSON.parse(await decrypter.decrypt(new Uint8Array(readFileSync(file)), 'text'))

const q = (v) =>
  v === null || v === undefined
    ? 'null'
    : typeof v === 'number'
      ? String(v)
      : `'${String(v).replaceAll("'", "''")}'`
const at = new Date().toISOString()
const a = exp.workwarden.account
const sql = []
sql.push(
  `insert into users (id, email, name, password_hash, salt, password_hint, kdf_type, kdf_iterations, kdf_memory, kdf_parallelism, akey, private_key, public_key, security_stamp, created_at, revision_date) values (${[a.id, a.email, a.name, a.passwordHash, a.salt, a.passwordHint, a.kdfType, a.kdfIterations, a.kdfMemory, a.kdfParallelism, a.key, a.privateKey, a.publicKey, crypto.randomUUID(), at, at].map(q).join(', ')});`,
)
for (const f of exp.folders)
  sql.push(
    `insert into folders (id, user_id, name, created_at, revision_date) values (${[f.id, a.id, f.name, at, at].map(q).join(', ')});`,
  )
const SERVER = [
  'id',
  'organizationId',
  'folderId',
  'type',
  'favorite',
  'reprompt',
  'collectionIds',
  'creationDate',
  'revisionDate',
  'deletedDate',
]
for (const item of exp.items) {
  const data = { ...item }
  for (const k of SERVER) delete data[k]
  sql.push(
    `insert into ciphers (id, user_id, folder_id, type, data, favorite, reprompt, created_at, revision_date, deleted_at) values (${[item.id, a.id, item.folderId ?? null, item.type, JSON.stringify(data), item.favorite ? 1 : 0, item.reprompt ?? 0, item.creationDate ?? at, item.revisionDate ?? at, item.deletedDate ?? null].map(q).join(', ')});`,
  )
}

const out = join(tmpdir(), `workwarden-restore-${Date.now()}.sql`)
writeFileSync(out, sql.join('\n'), { mode: 0o600 })
const target = flag === '--remote' ? '--remote' : '--local'
execFileSync(
  'npx',
  ['--no-install', 'wrangler', 'd1', 'execute', 'workwarden', target, '--file', out],
  { stdio: 'inherit' },
)
console.log(
  `restored ${a.email}: ${exp.folders.length} folders, ${exp.items.length} items (${target})`,
)
