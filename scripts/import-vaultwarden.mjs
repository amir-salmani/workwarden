// Import a Vaultwarden vault into workwarden, from that server's own database.
//
//   node scripts/import-vaultwarden.mjs db.sqlite3 [--only you@example.com]
//
// --only restricts the import to one account's personal vault.
//
// Organization ciphers are counted and skipped. They are encrypted under the
// organization's key, which this process never holds, so nothing here can move
// them into the flat model -- that takes a logged-in client, which is what
// scripts/flatten-orgs.mjs is for. See docs/FLATTENING.md.
//
// Vaultwarden keeps a cipher split across columns (name, notes, fields, data,
// password_history); Bitwarden's wire format is one object. This rebuilds that
// object, which is what workwarden stores.
//
// Users arrive *claimable*: key material intact, no password hash, one
// single-use token printed at the end. The two servers' hashes are not
// convertible in either direction -- see the 20260911000005 migration and
// docs/MIGRATION.md. Nothing here can read a vault; every value moved is
// ciphertext under a master key this process never sees.
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import postgres from 'postgres'

const dbPath = process.argv[2]
const onlyFlag = process.argv.indexOf('--only')
const only = onlyFlag > -1 ? process.argv[onlyFlag + 1]?.toLowerCase() : null
if (!dbPath) throw new Error('usage: import-vaultwarden.mjs <vaultwarden.sqlite3> [--only email]')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')

const vw = new DatabaseSync(dbPath, { readOnly: true })
const rows = (q, ...a) => vw.prepare(q).all(...a)

const sql = postgres(process.env.DATABASE_URL)
const claims = []

// Vaultwarden stores a cipher's data with PascalCase keys and lower-cases the
// first letter when it serves a client -- so the stored form is not the wire
// form. Importing it verbatim produces items whose `Username` and `Password` no
// client can find. This is the same conversion Vaultwarden does on read.
const camel = (v) => {
  if (Array.isArray(v)) return v.map(camel)
  if (v === null || typeof v !== 'object') return v
  return Object.fromEntries(
    Object.entries(v).map(([k, val]) => [k.charAt(0).toLowerCase() + k.slice(1), camel(val)]),
  )
}

const parse = (v, fallback) => {
  if (v === null || v === undefined || v === '') return fallback
  try {
    return JSON.parse(v)
  } catch {
    return fallback
  }
}

// Vaultwarden's atype. 5 is Bitwarden's newer SSH key type -- a real vault had
// one, and without it the item would import stripped of its contents.
const TYPE_KEY = { 1: 'login', 2: 'secureNote', 3: 'card', 4: 'identity', 5: 'sshKey' }

// Vaultwarden keeps an item's own fields beside the type-specific blob;
// Bitwarden's format has them at the top level of one object. Shared and
// personal ciphers go through the same conversion, so they cannot diverge.
function cipherData(cipher) {
  const key = TYPE_KEY[cipher.atype]
  if (!key) throw new Error(`cipher ${cipher.uuid}: unknown Vaultwarden atype ${cipher.atype}`)
  return {
    name: cipher.name,
    notes: cipher.notes ?? null,
    fields: camel(parse(cipher.fields, null)),
    passwordHistory: camel(parse(cipher.password_history, null)),
    key: cipher.key ?? null,
    [key]: camel(parse(cipher.data, {})),
  }
}

const users = rows('select * from users').filter(
  (u) => !only || String(u.email).toLowerCase() === only,
)
if (users.length === 0) throw new Error(`no user matching ${only} in this database`)
const userIds = new Set(users.map((u) => u.uuid))

for (const user of users) {
  const favourites = new Set(
    rows('select cipher_uuid from favorites where user_uuid = ?', user.uuid).map(
      (r) => r.cipher_uuid,
    ),
  )
  const folderOf = new Map(
    rows(
      `select fc.cipher_uuid, fc.folder_uuid from folders_ciphers fc
       join folders f on f.uuid = fc.folder_uuid where f.user_uuid = ?`,
      user.uuid,
    ).map((r) => [r.cipher_uuid, r.folder_uuid]),
  )

  const token = randomBytes(24).toString('base64url')

  await sql.begin(async (tx) => {
    await tx`
      insert into users (
        id, email, name, password_hash, salt, password_hint,
        kdf_type, kdf_iterations, kdf_memory, kdf_parallelism,
        akey, private_key, public_key, claim_token
      ) values (
        ${user.uuid}, ${String(user.email).toLowerCase()}, ${user.name ?? null},
        null, ${randomBytes(32).toString('base64')}, ${user.password_hint ?? null},
        ${user.client_kdf_type ?? 0}, ${user.client_kdf_iter ?? 600000},
        ${user.client_kdf_memory ?? null}, ${user.client_kdf_parallelism ?? null},
        ${user.akey}, ${user.private_key ?? null}, ${user.public_key ?? null},
        ${token}
      )
      on conflict (id) do nothing`

    for (const folder of rows('select * from folders where user_uuid = ?', user.uuid)) {
      await tx`
        insert into folders (id, user_id, name, created_at, revision_date)
        values (${folder.uuid}, ${user.uuid}, ${folder.name},
                ${folder.created_at ?? null}, ${folder.updated_at ?? null})
        on conflict (id) do nothing`
    }

    for (const cipher of rows(
      'select * from ciphers where user_uuid = ? and organization_uuid is null',
      user.uuid,
    )) {
      const data = cipherData(cipher)
      await tx`
        insert into ciphers (
          id, user_id, folder_id, type, data, favorite, reprompt,
          created_at, revision_date, deleted_at
        ) values (
          ${cipher.uuid}, ${user.uuid}, ${folderOf.get(cipher.uuid) ?? null},
          ${cipher.atype}, ${tx.json(data)}, ${favourites.has(cipher.uuid)},
          ${cipher.reprompt ?? 0}, ${cipher.created_at ?? null},
          ${cipher.updated_at ?? null}, ${cipher.deleted_at ?? null}
        )
        on conflict (id) do nothing`
    }
  })

  const counts = rows(
    'select (select count(*) from ciphers where user_uuid = ? and organization_uuid is null) as c, (select count(*) from folders where user_uuid = ?) as f',
    user.uuid,
    user.uuid,
  )[0]
  console.log(`ok   ${user.email}: ${counts.c} ciphers, ${counts.f} folders`)
  claims.push({ email: String(user.email).toLowerCase(), token })
}

// Attachment metadata. The blobs themselves live in R2 and are uploaded
// separately from the Vaultwarden data directory -- see docs/MIGRATION.md.
// Rows without their blob would show a client a file it cannot fetch, so the
// importer reports what still needs uploading.
const pendingBlobs = []
for (const a of rows('select * from attachments')) {
  const owned = await sql`
    select 1 from ciphers where id = ${a.cipher_uuid} limit 1`
  if (owned.length === 0) continue
  await sql`
    insert into attachments (id, cipher_id, file_name, file_size, akey)
    values (${a.id}, ${a.cipher_uuid}, ${a.file_name}, ${Number(a.file_size)}, ${a.akey ?? null})
    on conflict (id) do nothing`
  pendingBlobs.push(`${a.cipher_uuid}/${a.id}`)
}
if (pendingBlobs.length > 0) {
  console.log(`ok   ${pendingBlobs.length} attachment record(s); upload the blobs with:`)
  for (const k of pendingBlobs) {
    console.log(
      `       wrangler r2 object put workwarden-attachments/${k} --file data/attachments/${k} --remote`,
    )
  }
}

const orgCiphers = rows('select count(*) as n from ciphers where organization_uuid is not null')[0]
  .n
if (orgCiphers > 0) {
  console.log(`warn ${orgCiphers} organization cipher(s) skipped; flatten them from a client first`)
}

await sql.end()
vw.close()

console.log('\nEach vault needs claiming once before anyone can log in:\n')
for (const c of claims) console.log(`  ${c.email}  ${c.token}`)
