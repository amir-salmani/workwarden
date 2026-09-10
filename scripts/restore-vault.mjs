// Restore a vault from an age-encrypted export produced by export-vault.mjs.
//
// This is the other half of FEASIBILITY.md §2.4. A backup nobody has restored is
// a rumour, so this exists to be run -- against a scratch database, on purpose,
// before it is ever needed.
//
//   AGE_IDENTITY=~/.secrets/workwarden-backup-age.key \
//   DATABASE_URL=postgres://... node scripts/restore-vault.mjs backup.json.age
//
// The restored account keeps its original id, so a client that had synced
// before sees the same vault rather than a duplicate. Restoring requires the
// same AUTH_PEPPER the export was taken under: the stored password hash is
// peppered, and without it nobody can log in. Back the pepper up separately.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

const file = process.argv[2]
if (!file) throw new Error('usage: restore-vault.mjs <backup.json.age>')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')

const plaintext = file.endsWith('.age')
  ? execFileSync('age', ['--decrypt', '--identity', requireIdentity()], {
      input: readFileSync(file),
      maxBuffer: 256 * 1024 * 1024,
    }).toString()
  : readFileSync(file, 'utf8')

function requireIdentity() {
  const id = process.env.AGE_IDENTITY
  if (!id) throw new Error('AGE_IDENTITY is required to decrypt a .age backup')
  return id
}

const dump = JSON.parse(plaintext)
const account = dump.workwarden?.account
if (!account?.id) throw new Error('export has no workwarden.account block; it cannot be restored')

// Fields cipher_details computes. Storing them would let a restored row override
// the view, which is the bug that broke `bw` on create.
const SERVER_FIELDS = new Set([
  'id',
  'type',
  'folderId',
  'favorite',
  'reprompt',
  'organizationId',
  'collectionIds',
  'edit',
  'viewPassword',
  'attachments',
  'attachments2',
  'creationDate',
  'revisionDate',
  'deletedDate',
  'lastKnownRevisionDate',
  'object',
])

const sql = postgres(process.env.DATABASE_URL)

await sql.begin(async (tx) => {
  await tx`
    insert into users (
      id, email, name, password_hash, salt, password_hint,
      kdf_type, kdf_iterations, kdf_memory, kdf_parallelism,
      akey, private_key, public_key
    ) values (
      ${account.id}, ${account.email}, ${account.name ?? null},
      ${account.passwordHash}, ${account.salt}, ${account.passwordHint ?? null},
      ${account.kdfType}, ${account.kdfIterations},
      ${account.kdfMemory ?? null}, ${account.kdfParallelism ?? null},
      ${account.key}, ${account.privateKey ?? null}, ${account.publicKey ?? null}
    )
    on conflict (id) do update set
      email = excluded.email, name = excluded.name,
      password_hash = excluded.password_hash, salt = excluded.salt,
      akey = excluded.akey, private_key = excluded.private_key,
      public_key = excluded.public_key`

  for (const folder of dump.folders ?? []) {
    await tx`
      insert into folders (id, user_id, name) values (${folder.id}, ${account.id}, ${folder.name})
      on conflict (id) do update set name = excluded.name`
  }

  for (const item of dump.items ?? []) {
    const data = Object.fromEntries(Object.entries(item).filter(([k]) => !SERVER_FIELDS.has(k)))
    await tx`
      insert into ciphers (id, user_id, folder_id, type, data, favorite, reprompt, deleted_at)
      values (
        ${item.id}, ${account.id}, ${item.folderId ?? null}, ${item.type},
        ${tx.json(data)}, ${item.favorite ?? false}, ${item.reprompt ?? 0},
        ${item.deletedDate ?? null}
      )
      on conflict (id) do update set
        folder_id = excluded.folder_id, type = excluded.type, data = excluded.data,
        favorite = excluded.favorite, reprompt = excluded.reprompt,
        deleted_at = excluded.deleted_at`
  }
})

await sql.end()
console.log(
  `ok   restored ${account.email}: ${(dump.items ?? []).length} items, ${(dump.folders ?? []).length} folders`,
)
