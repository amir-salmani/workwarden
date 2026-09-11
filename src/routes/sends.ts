import { Hono } from 'hono'
import type { JSONValue } from 'postgres'
import { z } from 'zod'
import type { App } from '../app.ts'
import { requireUser } from '../auth/session.ts'
import type { Sql } from '../db.ts'
import { apiError, insensitive } from '../http.ts'
import { Notification, push } from '../notify.ts'

export const sends = new Hono<App>()
sends.use('*', requireUser())

/**
 * A Send's payload is encrypted under its own key, which the recipient gets
 * from the URL fragment. Browsers never send a fragment to the server, so this
 * holds the data and never the means to read it -- including during an
 * anonymous download.
 */
const sendInput = z.object({
  type: z.number(),
  name: z.string().min(1),
  notes: z.string().nullish(),
  key: z.string().min(1),
  text: z.record(z.string(), z.unknown()).nullish(),
  file: z.record(z.string(), z.unknown()).nullish(),
  maxAccessCount: z.number().nullish(),
  password: z.string().nullish(),
  disabled: z.boolean().nullish(),
  hideEmail: z.boolean().nullish(),
  expirationDate: z.string().nullish(),
  deletionDate: z.string(),
})

sends.get('/', async (c) => {
  const rows = await c.get('sql')<{ json: unknown }[]>`
    select json from send_details where user_id = ${c.get('user').id} order by json->>'name'`
  return c.json({ data: rows.map((r) => r.json), continuationToken: null, object: 'list' })
})

sends.get('/:id', async (c) => {
  const found = await detail(c.get('sql'), c.get('user').id, c.req.param('id'))
  return found ? c.json(found) : apiError(c, 'Send not found', 404)
})

/**
 * File Sends, the two-step v2 flow: reserve the send, then push the bytes.
 *
 * The cap is this server's, not Bitwarden's: `formData()` buffers the upload in
 * an isolate with 128 MB of memory.
 */
export const MAX_SEND_FILE = 25 * 1024 * 1024

const fileSendInput = z.object({
  fileLength: z.coerce.number().int().positive().max(MAX_SEND_FILE),
})

sends.post('/file/v2', async (c) => {
  const body = insensitive(await c.req.json().catch(() => ({})))
  const parsed = sendInput.safeParse(body)
  const length = fileSendInput.safeParse(body)
  if (!parsed.success || !length.success) return apiError(c, 'Send is missing required fields')
  if (parsed.data.type !== 1) return apiError(c, 'That Send is not a file Send')

  const fileName = insensitive(parsed.data.file ?? {}).fileName
  if (typeof fileName !== 'string' || !fileName) return apiError(c, 'Send is missing a file name')

  const sql = c.get('sql')
  const fileId = crypto.randomUUID().replaceAll('-', '')
  const s = parsed.data
  const rows = await sql<{ id: string }[]>`
    insert into sends (
      user_id, type, name, notes, data, akey, password_hash,
      max_access_count, expiration_date, deletion_date, disabled, hide_email
    ) values (
      ${c.get('user').id}, 1, ${s.name}, ${s.notes ?? null},
      ${sql.json(fileBlob(fileId, fileName, length.data.fileLength))}, ${s.key},
      ${s.password ?? null}, ${s.maxAccessCount ?? null},
      ${s.expirationDate ?? null}, ${s.deletionDate},
      ${s.disabled ?? false}, ${s.hideEmail ?? false}
    ) returning id`
  const id = rows[0]?.id
  if (!id) return apiError(c, 'Could not create send', 500)

  push(c, Notification.SyncSendCreate, { Id: id })
  return c.json({
    fileUploadType: 0, // direct to this server; there is no blob service in front
    url: `${new URL(c.req.url).origin}/api/sends/${id}/file/${fileId}`,
    sendResponse: await detail(sql, c.get('user').id, id),
    object: 'send-fileUpload',
  })
})

// The one-request upload older clients used. Bitwarden dropped it in 2023.
sends.post('/file', (c) => apiError(c, 'Update your client to upload file Sends'))

sends.post('/:id/file/:fileId', async (c) => {
  const { id, fileId } = c.req.param()
  const sql = c.get('sql')
  const rows = await sql<{ size: number; uploaded: boolean }[]>`
    select (data->>'size')::int as size, (data->>'uploaded')::bool as uploaded
      from sends
     where id = ${id} and user_id = ${c.get('user').id}
       and type = 1 and data->>'id' = ${fileId}`
  const reserved = rows[0]
  // One upload per reservation: a second would silently replace the first.
  if (!reserved || reserved.uploaded) return apiError(c, 'Send not found', 404)

  const form = await c.req.formData().catch(() => null)
  const file = form?.get('data')
  if (!(file instanceof File)) return apiError(c, 'No file was uploaded')
  if (file.size > Math.min(reserved.size, MAX_SEND_FILE)) {
    await sql`delete from sends where id = ${id} and user_id = ${c.get('user').id}`
    return apiError(c, 'That file is larger than the Send reserved for it')
  }

  await c.env.ATTACHMENTS.put(sendFileKey(id, fileId), file.stream())
  // Trust the bytes that arrived over the size the client promised.
  await sql`
    update sends
       set data = data || ${sql.json({ size: file.size, sizeName: displaySize(file.size), uploaded: true })},
           revision_date = now()
     where id = ${id} and user_id = ${c.get('user').id}`
  push(c, Notification.SyncSendUpdate, { Id: id })
  return c.body(null, 200)
})

sends.post('/', async (c) => {
  const parsed = sendInput.safeParse(insensitive(await c.req.json()))
  if (!parsed.success) return apiError(c, 'Send is missing required fields')
  const s = parsed.data
  const sql = c.get('sql')

  const rows = await sql<{ id: string }[]>`
    insert into sends (
      user_id, type, name, notes, data, akey, password_hash,
      max_access_count, expiration_date, deletion_date, disabled, hide_email
    ) values (
      ${c.get('user').id}, ${s.type}, ${s.name}, ${s.notes ?? null},
      ${sql.json(payload(s))}, ${s.key},
      ${s.password ?? null}, ${s.maxAccessCount ?? null},
      ${s.expirationDate ?? null}, ${s.deletionDate},
      ${s.disabled ?? false}, ${s.hideEmail ?? false}
    ) returning id`
  const id = rows[0]?.id
  if (!id) return apiError(c, 'Could not create send', 500)
  push(c, Notification.SyncSendCreate, { Id: id })
  return c.json(await detail(sql, c.get('user').id, id))
})

sends.put('/:id', async (c) => {
  const id = c.req.param('id')
  const parsed = sendInput.safeParse(insensitive(await c.req.json()))
  if (!parsed.success) return apiError(c, 'Send is missing required fields')
  const s = parsed.data
  const sql = c.get('sql')

  const rows = await sql<{ id: string }[]>`
    update sends set
      type = ${s.type}, name = ${s.name}, notes = ${s.notes ?? null},
      -- A file Send's descriptor is the server's, not the client's: keep it.
      data = case when type = 1 then data else ${sql.json(payload(s))}::jsonb end,
      akey = ${s.key}, password_hash = ${s.password ?? null},
      max_access_count = ${s.maxAccessCount ?? null},
      expiration_date = ${s.expirationDate ?? null},
      deletion_date = ${s.deletionDate},
      disabled = ${s.disabled ?? false}, hide_email = ${s.hideEmail ?? false},
      revision_date = now()
    where id = ${id} and user_id = ${c.get('user').id}
    returning id`
  if (!rows[0]) return apiError(c, 'Send not found', 404)
  push(c, Notification.SyncSendUpdate, { Id: id })
  return c.json(await detail(sql, c.get('user').id, id))
})

sends.delete('/:id', async (c) => {
  const rows = await c.get('sql')<{ file_id: string | null }[]>`
    delete from sends where id = ${c.req.param('id')} and user_id = ${c.get('user').id}
    returning data->>'id' as file_id`
  const fileId = rows[0]?.file_id
  // The row is the record of existence; a blob without one is unreachable.
  if (fileId) await c.env.ATTACHMENTS.delete(sendFileKey(c.req.param('id'), fileId))
  push(c, Notification.SyncSendDelete, { Id: c.req.param('id') })
  return c.body(null, 200)
})

// Removing the password is a separate call in the Bitwarden API.
sends.put('/:id/remove-password', async (c) => {
  const id = c.req.param('id')
  const sql = c.get('sql')
  await sql`
    update sends set password_hash = null, revision_date = now()
     where id = ${id} and user_id = ${c.get('user').id}`
  return c.json(await detail(sql, c.get('user').id, id))
})

export function sendFileKey(sendId: string, fileId: string) {
  return `sends/${sendId}/${fileId}`
}

function fileBlob(id: string, fileName: string, size: number): JSONValue {
  return { id, fileName, size, sizeName: displaySize(size), uploaded: false }
}

function displaySize(bytes: number): string {
  const units = ['Bytes', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${unit === 0 ? value : value.toFixed(2)} ${units[unit]}`
}

/** A Send is either a text body or a file descriptor, never both. */
function payload(s: z.infer<typeof sendInput>): JSONValue {
  return ((s.type === 1 ? s.file : s.text) ?? {}) as JSONValue
}

async function detail(sql: Sql, userId: string, id: string) {
  const rows = await sql<{ json: unknown }[]>`
    select json from send_details where id = ${id} and user_id = ${userId}`
  return rows[0]?.json
}
