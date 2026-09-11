import type { Context } from 'hono'
import { Hono } from 'hono'
import type { JSONValue } from 'postgres'
import { z } from 'zod'
import type { App } from '../app.ts'
import { requireUser } from '../auth/session.ts'
import type { Sql } from '../db.ts'
import { apiError, insensitive } from '../http.ts'

export const ciphers = new Hono<App>()
ciphers.use('*', requireUser())

// Everything except these is the client's encrypted blob and is stored whole.
// Two groups: fields cipher_details computes, and fields the client sends on a
// request that are meaningless in a response. Storing either means echoing the
// client's own value back and overriding the view -- `attachments: {}` did
// exactly that and crashed `bw`.
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

ciphers.post('/', async (c) => {
  const body = insensitive(await c.req.json())
  const parsed = cipherInput.safeParse(body)
  if (!parsed.success) return apiError(c, 'Cipher is missing required fields')

  const rows = await c.get('sql')<{ id: string }[]>`
    insert into ciphers (user_id, folder_id, type, data, favorite, reprompt)
    values (
      ${c.get('user').id}, ${parsed.data.folderId ?? null}, ${parsed.data.type},
      ${c.get('sql').json(blob(body))}, ${parsed.data.favorite ?? false},
      ${parsed.data.reprompt ?? 0}
    ) returning id`
  const id = rows[0]?.id
  if (!id) return apiError(c, 'Could not create cipher', 500)
  return c.json(await detail(c.get('sql'), c.get('user').id, id, new URL(c.req.url).origin))
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
  const userId = c.get('user').id
  const sql = c.get('sql')

  await sql.begin(async (tx) => {
    const folderIds: string[] = []
    for (const folder of incomingFolders) {
      const rows = await tx<{ id: string }[]>`
        insert into folders (user_id, name) values (${userId}, ${folder.name}) returning id`
      folderIds.push(rows[0]?.id ?? '')
    }

    const folderFor = new Map(folderRelationships.map((r) => [r.key, folderIds[r.value]]))

    for (const [index, raw] of incoming.entries()) {
      const cipher = insensitive(raw)
      const parsedCipher = cipherInput.safeParse(cipher)
      if (!parsedCipher.success) continue
      await tx`
        insert into ciphers (user_id, folder_id, type, data, favorite, reprompt)
        values (
          ${userId}, ${folderFor.get(index) ?? null}, ${parsedCipher.data.type},
          ${tx.json(blob(cipher))}, ${parsedCipher.data.favorite ?? false},
          ${parsedCipher.data.reprompt ?? 0}
        )`
    }
  })

  return c.body(null, 200)
})

ciphers.get('/:id', async (c) => {
  const found = await detail(
    c.get('sql'),
    c.get('user').id,
    c.req.param('id'),
    new URL(c.req.url).origin,
  )
  return found ? c.json(found) : apiError(c, 'Cipher not found', 404)
})

// Clients have used both verbs for an update over the years.
ciphers.on(['PUT', 'POST'], '/:id', async (c) => {
  const id = c.req.param('id')
  const body = insensitive(await c.req.json())
  const parsed = cipherInput.safeParse(body)
  if (!parsed.success) return apiError(c, 'Cipher is missing required fields')

  const rows = await c.get('sql')<{ id: string }[]>`
    update ciphers set
      folder_id     = ${parsed.data.folderId ?? null},
      type          = ${parsed.data.type},
      data          = ${c.get('sql').json(blob(body))},
      favorite      = ${parsed.data.favorite ?? false},
      reprompt      = ${parsed.data.reprompt ?? 0},
      revision_date = now()
    where id = ${id} and user_id = ${c.get('user').id}
    returning id`
  if (!rows[0]) return apiError(c, 'Cipher not found', 404)
  return c.json(await detail(c.get('sql'), c.get('user').id, id, new URL(c.req.url).origin))
})

// Soft delete -- the client's trash. `DELETE` is the permanent one.
ciphers.on(['PUT', 'POST'], '/:id/delete', async (c) => {
  await c.get('sql')`
    update ciphers set deleted_at = now(), revision_date = now()
    where id = ${c.req.param('id')} and user_id = ${c.get('user').id}`
  return c.body(null, 200)
})

ciphers.on(['PUT', 'POST'], '/:id/restore', async (c) => {
  await c.get('sql')`
    update ciphers set deleted_at = null, revision_date = now()
    where id = ${c.req.param('id')} and user_id = ${c.get('user').id}`
  return c.json(
    await detail(c.get('sql'), c.get('user').id, c.req.param('id'), new URL(c.req.url).origin),
  )
})

/**
 * Attachment upload, the two-step v2 flow: reserve a record, then send bytes.
 *
 * The client encrypts the file with its own attachment key before uploading, so
 * what arrives is ciphertext and the server never learns the contents or even
 * the real filename -- `fileName` is an EncString too.
 */
const attachmentInput = z.object({
  fileName: z.string().min(1),
  key: z.string().min(1),
  fileSize: z.coerce.number().int().positive(),
})

ciphers.post('/:id/attachment/v2', async (c) => {
  const cipherId = c.req.param('id')
  const parsed = attachmentInput.safeParse(insensitive(await c.req.json()))
  if (!parsed.success) return apiError(c, 'Attachment metadata is incomplete')

  const owned = await ownedByUser(c.get('sql'), c.get('user').id, cipherId)
  if (!owned) return apiError(c, 'Cipher not found', 404)

  const attachmentId = crypto.randomUUID().replaceAll('-', '').slice(0, 20)
  await c.get('sql')`
    insert into attachments (id, cipher_id, file_name, file_size, akey)
    values (${attachmentId}, ${cipherId}, ${parsed.data.fileName},
            ${parsed.data.fileSize}, ${parsed.data.key})`

  const origin = new URL(c.req.url).origin
  return c.json({
    attachmentId,
    url: `${origin}/api/ciphers/${cipherId}/attachment/${attachmentId}`,
    fileUploadType: 0, // direct to this server; there is no blob service in front
    cipherResponse: await detail(c.get('sql'), c.get('user').id, cipherId, origin),
  })
})

ciphers.post('/:id/attachment/:attachmentId', async (c) => {
  const cipherId = c.req.param('id')
  const attachmentId = c.req.param('attachmentId')
  const rows = await c.get('sql')<{ file_size: string }[]>`
    select a.file_size
      from attachments a
      join visible_ciphers vc on vc.cipher_id = a.cipher_id
     where a.id = ${attachmentId} and a.cipher_id = ${cipherId}
       and vc.user_id = ${c.get('user').id}`
  if (rows.length === 0) return apiError(c, 'Attachment not found', 404)

  const form = await c.req.formData().catch(() => null)
  const file = form?.get('data')
  if (!(file instanceof File)) return apiError(c, 'No file was uploaded')

  await c.env.ATTACHMENTS.put(`${cipherId}/${attachmentId}`, file.stream())
  // Trust the bytes that arrived over the size the client promised.
  await c.get('sql')`
    update attachments set file_size = ${file.size} where id = ${attachmentId}`
  return c.body(null, 200)
})

ciphers.on(['DELETE', 'POST'], '/:id/attachment/:attachmentId/delete', (c) => removeAttachment(c))
ciphers.delete('/:id/attachment/:attachmentId', (c) => removeAttachment(c))

ciphers.delete('/:id', async (c) => {
  await c.get('sql')`
    delete from ciphers where id = ${c.req.param('id')} and user_id = ${c.get('user').id}`
  return c.body(null, 200)
})

async function ownedByUser(sql: Sql, userId: string, cipherId: string) {
  const rows = await sql`
    select 1 from visible_ciphers where cipher_id = ${cipherId} and user_id = ${userId}`
  return rows.length > 0
}

async function removeAttachment(c: Context<App>) {
  const cipherId = c.req.param('id') ?? ''
  const attachmentId = c.req.param('attachmentId') ?? ''
  const sql = c.get('sql')
  const rows = await sql<{ id: string }[]>`
    delete from attachments a
     using visible_ciphers vc
     where vc.cipher_id = a.cipher_id
       and a.id = ${attachmentId} and a.cipher_id = ${cipherId}
       and vc.user_id = ${c.get('user').id}
    returning a.id`
  if (rows.length === 0) return apiError(c, 'Attachment not found', 404)
  // The row is the record of existence; a blob without one is unreachable.
  await c.env.ATTACHMENTS.delete(`${cipherId}/${attachmentId}`)
  return c.body(null, 200)
}

function blob(body: Record<string, unknown>): JSONValue {
  const out = { ...body }
  for (const field of SERVER_FIELDS) delete out[field]
  return out as JSONValue
}

async function detail(sql: Sql, userId: string, id: string, origin: string) {
  const rows = await sql<{ json: unknown }[]>`
    select cipher_json(ch, ${origin}) as json
      from ciphers ch
      join visible_ciphers vc on vc.cipher_id = ch.id
     where ch.id = ${id} and vc.user_id = ${userId}`
  return rows[0]?.json
}
