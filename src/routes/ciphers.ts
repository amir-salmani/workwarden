import { Hono } from 'hono'
import { z } from 'zod'
import type { App } from '../app.ts'
import { requireUser } from '../auth/session.ts'
import { type Db, now, touch, uuid } from '../db.ts'
import { apiError, insensitive } from '../http.ts'
import { type CipherRow, cipherJson } from '../wire.ts'

export const ciphers = new Hono<App>()
ciphers.use('*', requireUser())

// Everything except these is the client's encrypted blob and is stored whole.
// Two groups: fields the wire format computes, and fields the client sends on
// a request that are meaningless in a response. Storing either means echoing
// the client's own value back and overriding the view -- `attachments: {}`
// did exactly that and crashed `bw`.
const SERVER_FIELDS = [
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
] as const

const cipherInput = z.object({
  type: z.number(),
  folderId: z.string().uuid().nullish(),
  favorite: z.boolean().nullish(),
  reprompt: z.number().nullish(),
})

const INSERT =
  'insert into ciphers (id, user_id, folder_id, type, data, favorite, reprompt, created_at, revision_date) values (?, ?, ?, ?, ?, ?, ?, ?, ?)'

ciphers.post('/', async (c) => {
  const body = insensitive(await c.req.json())
  const parsed = cipherInput.safeParse(body)
  if (!parsed.success) return apiError(c, 'Cipher is missing required fields')

  const db = c.get('db')
  const user = c.get('user')
  const id = uuid()
  const at = now()
  await db.batch([
    db
      .prepare(INSERT)
      .bind(
        id,
        user.id,
        parsed.data.folderId ?? null,
        parsed.data.type,
        JSON.stringify(cipherBlob(body)),
        parsed.data.favorite ? 1 : 0,
        parsed.data.reprompt ?? 0,
        at,
        at,
      ),
    touch(db, user.id, at),
  ])
  return c.json(await detail(db, user.id, id))
})

/**
 * Bulk import, used by `bw import` and the web vault's importer. It must be
 * declared before `/:id`, or that route matches "import" as a cipher id and
 * answers 400 -- which is exactly how this endpoint's absence presented.
 *
 * `folderRelationships` maps an index in `ciphers` to an index in `folders`,
 * because neither list has server ids yet.
 */
const importInput = z.object({
  ciphers: z.array(z.record(z.string(), z.unknown())).default([]),
  folders: z.array(z.object({ name: z.string() })).default([]),
  folderRelationships: z.array(z.object({ key: z.number(), value: z.number() })).default([]),
})

ciphers.post('/import', async (c) => {
  const parsed = importInput.safeParse(insensitive(await c.req.json()))
  if (!parsed.success) return apiError(c, 'Import data is malformed')

  const { ciphers: incoming, folders: incomingFolders, folderRelationships } = parsed.data
  const db = c.get('db')
  const user = c.get('user')
  const at = now()

  const folderIds = incomingFolders.map(() => uuid())
  const folderFor = new Map(folderRelationships.map((r) => [r.key, folderIds[r.value]]))

  const statements = incomingFolders.map((folder, i) =>
    db
      .prepare(
        'insert into folders (id, user_id, name, created_at, revision_date) values (?, ?, ?, ?, ?)',
      )
      .bind(folderIds[i], user.id, folder.name, at, at),
  )
  for (const [index, raw] of incoming.entries()) {
    const cipher = insensitive(raw)
    const parsedCipher = cipherInput.safeParse(cipher)
    if (!parsedCipher.success) continue
    statements.push(
      db
        .prepare(INSERT)
        .bind(
          uuid(),
          user.id,
          folderFor.get(index) ?? null,
          parsedCipher.data.type,
          JSON.stringify(cipherBlob(cipher)),
          parsedCipher.data.favorite ? 1 : 0,
          parsedCipher.data.reprompt ?? 0,
          at,
          at,
        ),
    )
  }
  statements.push(touch(db, user.id, at))
  // One batch is one transaction: a half-imported vault never lands.
  await db.batch(statements)
  return c.body(null, 200)
})

ciphers.get('/:id', async (c) => {
  const found = await detail(c.get('db'), c.get('user').id, c.req.param('id'))
  return found ? c.json(found) : apiError(c, 'Cipher not found', 404)
})

// Clients have used both verbs for an update over the years.
ciphers.on(['PUT', 'POST'], '/:id', async (c) => {
  const id = c.req.param('id')
  const body = insensitive(await c.req.json())
  const parsed = cipherInput.safeParse(body)
  if (!parsed.success) return apiError(c, 'Cipher is missing required fields')

  const db = c.get('db')
  const user = c.get('user')
  const at = now()
  const [updated] = await db.batch([
    db
      .prepare(
        'update ciphers set folder_id = ?, type = ?, data = ?, favorite = ?, reprompt = ?, revision_date = ? where id = ? and user_id = ?',
      )
      .bind(
        parsed.data.folderId ?? null,
        parsed.data.type,
        JSON.stringify(cipherBlob(body)),
        parsed.data.favorite ? 1 : 0,
        parsed.data.reprompt ?? 0,
        at,
        id,
        user.id,
      ),
    touch(db, user.id, at),
  ])
  if (!updated?.meta.changes) return apiError(c, 'Cipher not found', 404)
  return c.json(await detail(db, user.id, id))
})

// Soft delete -- the client's trash. `DELETE` is the permanent one.
ciphers.on(['PUT', 'POST'], '/:id/delete', async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const at = now()
  await db.batch([
    db
      .prepare('update ciphers set deleted_at = ?, revision_date = ? where id = ? and user_id = ?')
      .bind(at, at, c.req.param('id'), user.id),
    touch(db, user.id, at),
  ])
  return c.body(null, 200)
})

ciphers.on(['PUT', 'POST'], '/:id/restore', async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const at = now()
  await db.batch([
    db
      .prepare(
        'update ciphers set deleted_at = null, revision_date = ? where id = ? and user_id = ?',
      )
      .bind(at, c.req.param('id'), user.id),
    touch(db, user.id, at),
  ])
  return c.json(await detail(db, user.id, c.req.param('id')))
})

ciphers.delete('/:id', async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  await db.batch([
    db.prepare('delete from ciphers where id = ? and user_id = ?').bind(c.req.param('id'), user.id),
    touch(db, user.id),
  ])
  return c.body(null, 200)
})

export function cipherBlob(body: Record<string, unknown>): Record<string, unknown> {
  const out = { ...body }
  for (const field of SERVER_FIELDS) delete out[field]
  return out
}

async function detail(db: Db, userId: string, id: string) {
  const row = await db
    .prepare('select * from ciphers where id = ? and user_id = ?')
    .bind(id, userId)
    .first<CipherRow>()
  return row ? cipherJson(row) : undefined
}
