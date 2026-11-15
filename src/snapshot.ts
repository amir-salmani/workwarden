import { Encrypter } from 'age-encryption'
import { type Db, now, uuid } from './db.ts'
import type { User } from './users.ts'
import { type CipherRow, cipherJson, type FolderRow } from './wire.ts'

/**
 * The backup artifact: everything needed to stand the vault up again, in
 * Bitwarden's shape, containing no plaintext. `items` and `folders` are
 * exactly the export format; `workwarden.account` is what makes it restorable
 * rather than merely readable. docs/BACKUP.md.
 */
export type VaultExport = {
  encrypted: true
  workwarden: {
    formatVersion: 1
    exportedAt: string
    account: {
      id: string
      email: string
      name: string | null
      passwordHash: string
      salt: string
      passwordHint: string | null
      kdfType: number
      kdfIterations: number
      kdfMemory: number | null
      kdfParallelism: number | null
      key: string
      privateKey: string | null
      publicKey: string | null
    }
  }
  folders: { id: string; name: string }[]
  items: Record<string, unknown>[]
}

// Present on the wire, meaningless in an export.
const VIEW_ONLY = [
  'edit',
  'viewPassword',
  'object',
  'attachments',
  'organizationUseTotp',
  'permissions',
]

export async function buildExport(db: Db, user: User): Promise<VaultExport> {
  const [folders, ciphers] = await db.batch([
    db.prepare('select * from folders where user_id = ? order by id').bind(user.id),
    db.prepare('select * from ciphers where user_id = ? order by id').bind(user.id),
  ])
  return {
    encrypted: true,
    workwarden: {
      formatVersion: 1,
      exportedAt: now(),
      account: {
        id: user.id,
        email: user.email,
        name: user.name,
        passwordHash: user.password_hash,
        salt: user.salt,
        passwordHint: user.password_hint,
        kdfType: user.kdf_type,
        kdfIterations: user.kdf_iterations,
        kdfMemory: user.kdf_memory,
        kdfParallelism: user.kdf_parallelism,
        key: user.akey,
        privateKey: user.private_key,
        publicKey: user.public_key,
      },
    },
    folders: ((folders?.results ?? []) as FolderRow[]).map((f) => ({ id: f.id, name: f.name })),
    items: ((ciphers?.results ?? []) as CipherRow[]).map((row) => {
      const item: Record<string, unknown> = { ...cipherJson(row), collectionIds: null }
      for (const k of VIEW_ONLY) delete item[k]
      return item
    }),
  }
}

/**
 * The inverse: statements that put an export back into an empty database.
 * The password hash carries over, so the same pepper must be on the Worker;
 * the security stamp is fresh, so every old token is dead.
 */
export function restoreStatements(db: Db, exp: VaultExport): D1PreparedStatement[] {
  const a = exp.workwarden.account
  const at = now()
  const user = db
    .prepare(
      `insert into users (
         id, email, name, password_hash, salt, password_hint,
         kdf_type, kdf_iterations, kdf_memory, kdf_parallelism,
         akey, private_key, public_key, security_stamp, created_at, revision_date
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      a.id,
      a.email,
      a.name,
      a.passwordHash,
      a.salt,
      a.passwordHint,
      a.kdfType,
      a.kdfIterations,
      a.kdfMemory,
      a.kdfParallelism,
      a.key,
      a.privateKey,
      a.publicKey,
      uuid(),
      at,
      at,
    )
  const folders = exp.folders.map((f) =>
    db
      .prepare(
        'insert into folders (id, user_id, name, created_at, revision_date) values (?, ?, ?, ?, ?)',
      )
      .bind(f.id, a.id, f.name, at, at),
  )
  const ciphers = exp.items.map((item) => {
    const data = { ...item }
    for (const k of [
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
    ]) {
      delete data[k]
    }
    return db
      .prepare(
        'insert into ciphers (id, user_id, folder_id, type, data, favorite, reprompt, created_at, revision_date, deleted_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        String(item.id),
        a.id,
        (item.folderId as string | null) ?? null,
        Number(item.type),
        JSON.stringify(data),
        item.favorite ? 1 : 0,
        Number(item.reprompt ?? 0),
        String(item.creationDate ?? at),
        String(item.revisionDate ?? at),
        (item.deletedDate as string | null) ?? null,
      )
  })
  return [user, ...folders, ...ciphers]
}

/**
 * Nightly: one age-encrypted export per user into R2, dated, plus `latest`.
 * The Worker holds the recipient only; whoever holds the identity can read it
 * back, and nobody else -- not this account, not Cloudflare.
 */
export async function snapshot(env: Env): Promise<string[]> {
  const users = await env.DB.prepare('select * from users').all<User>()
  const written: string[] = []
  for (const user of users.results) {
    const exp = await buildExport(env.DB, user)
    const encrypter = new Encrypter()
    encrypter.addRecipient(env.AGE_RECIPIENT)
    const body = await encrypter.encrypt(JSON.stringify(exp))
    const day = exp.workwarden.exportedAt.slice(0, 10)
    for (const key of [`${user.id}/${day}.json.age`, `${user.id}/latest.json.age`]) {
      await env.SNAPSHOTS.put(key, body, {
        httpMetadata: { contentType: 'application/octet-stream' },
      })
      written.push(key)
    }
  }
  return written
}
