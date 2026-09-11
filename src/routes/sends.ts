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
      data = ${sql.json(payload(s))},
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
  await c.get('sql')`
    delete from sends where id = ${c.req.param('id')} and user_id = ${c.get('user').id}`
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

/** A Send is either a text body or a file descriptor, never both. */
function payload(s: z.infer<typeof sendInput>): JSONValue {
  return ((s.type === 1 ? s.file : s.text) ?? {}) as JSONValue
}

async function detail(sql: Sql, userId: string, id: string) {
  const rows = await sql<{ json: unknown }[]>`
    select json from send_details where id = ${id} and user_id = ${userId}`
  return rows[0]?.json
}
