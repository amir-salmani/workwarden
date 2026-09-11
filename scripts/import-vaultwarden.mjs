// Import a Vaultwarden vault into workwarden, from that server's own database.
//
//   node scripts/import-vaultwarden.mjs db.sqlite3 [--only you@example.com]
//
// --only restricts the import to one account: their personal vault, plus every
// organization they belong to, with those organizations' collections and shared
// ciphers. Other members are not carried over, so their memberships are not
// either -- the organization arrives owned by whoever was imported.
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

// Organizations first: collections and shared ciphers reference them, and a
// membership is meaningless without the organization it points at.
const memberships = rows('select * from users_organizations').filter((m) =>
  userIds.has(m.user_uuid),
)
const orgIds = new Set(memberships.map((m) => m.org_uuid))

for (const org of rows('select * from organizations').filter((o) => orgIds.has(o.uuid))) {
  await sql`
    insert into organizations (id, name, billing_email, private_key, public_key)
    values (${org.uuid}, ${org.name}, ${org.billing_email ?? null},
            ${org.private_key ?? null}, ${org.public_key ?? null})
    on conflict (id) do nothing`
}

for (const col of rows('select * from collections').filter((c) => orgIds.has(c.org_uuid))) {
  await sql`
    insert into collections (id, organization_id, name, external_id)
    values (${col.uuid}, ${col.org_uuid}, ${col.name}, ${col.external_id ?? null})
    on conflict (id) do nothing`
}

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

  // Memberships carry the organization key wrapped for this member. Without it
  // the organization's ciphers are unreadable, however intact they look.
  for (const m of memberships.filter((m) => m.user_uuid === user.uuid)) {
    await sql`
      insert into organization_users (id, organization_id, user_id, akey, status, type, access_all)
      values (${m.uuid}, ${m.org_uuid}, ${user.uuid}, ${m.akey ?? null},
              ${m.status ?? 2}, ${m.atype ?? 2}, ${Boolean(m.access_all)})
      on conflict (organization_id, user_id) do nothing`
  }

  for (const uc of rows('select * from users_collections where user_uuid = ?', user.uuid)) {
    await sql`
      insert into collection_users (collection_id, user_id, read_only, hide_passwords, manage)
      values (${uc.collection_uuid}, ${user.uuid}, ${Boolean(uc.read_only)},
              ${Boolean(uc.hide_passwords)}, ${Boolean(uc.manage)})
      on conflict do nothing`
  }

  const counts = rows(
    'select (select count(*) from ciphers where user_uuid = ? and organization_uuid is null) as c, (select count(*) from folders where user_uuid = ?) as f',
    user.uuid,
    user.uuid,
  )[0]
  console.log(`ok   ${user.email}: ${counts.c} ciphers, ${counts.f} folders`)
  claims.push({ email: String(user.email).toLowerCase(), token })
}

// Shared ciphers belong to the organization, not to a member, so they are
// imported once, after the organizations exist.
let shared = 0
for (const orgId of orgIds) {
  for (const cipher of rows('select * from ciphers where organization_uuid = ?', orgId)) {
    await sql`
      insert into ciphers (
        id, user_id, organization_id, folder_id, type, data, favorite, reprompt,
        created_at, revision_date, deleted_at
      ) values (
        ${cipher.uuid}, null, ${orgId}, null, ${cipher.atype},
        ${sql.json(cipherData(cipher))}, false, ${cipher.reprompt ?? 0},
        ${cipher.created_at ?? null}, ${cipher.updated_at ?? null}, ${cipher.deleted_at ?? null}
      )
      on conflict (id) do nothing`
    shared++
  }
}

// Which collections each shared cipher sits in. Without these links the ciphers
// exist but appear in no collection, which is how a client shows them: missing.
let filed = 0
for (const cc of rows('select * from ciphers_collections')) {
  const rowsIn = await sql`
    select 1 from ciphers c, collections cl
     where c.id = ${cc.cipher_uuid} and cl.id = ${cc.collection_uuid} limit 1`
  if (rowsIn.length === 0) continue
  await sql`
    insert into collection_ciphers (collection_id, cipher_id)
    values (${cc.collection_uuid}, ${cc.cipher_uuid})
    on conflict do nothing`
  filed++
}

const totalOrgCiphers = rows(
  'select count(*) as n from ciphers where organization_uuid is not null',
)[0].n
console.log(
  `ok   ${orgIds.size} organization(s), ${shared} shared cipher(s), ${filed} collection link(s)`,
)
if (totalOrgCiphers > shared) {
  console.log(
    `     ${totalOrgCiphers - shared} cipher(s) left behind in organizations not being imported`,
  )
}

await sql.end()
vw.close()

console.log('\nEach vault needs claiming once before anyone can log in:\n')
for (const c of claims) console.log(`  ${c.email}  ${c.token}`)
