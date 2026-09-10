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
  return c.json(await detail(c.get('sql'), c.get('user').id, id))
})

ciphers.get('/:id', async (c) => {
  const found = await detail(c.get('sql'), c.get('user').id, c.req.param('id'))
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
  return c.json(await detail(c.get('sql'), c.get('user').id, id))
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
  return c.json(await detail(c.get('sql'), c.get('user').id, c.req.param('id')))
})

ciphers.delete('/:id', async (c) => {
  await c.get('sql')`
    delete from ciphers where id = ${c.req.param('id')} and user_id = ${c.get('user').id}`
  return c.body(null, 200)
})

function blob(body: Record<string, unknown>): JSONValue {
  const out = { ...body }
  for (const field of SERVER_FIELDS) delete out[field]
  return out as JSONValue
}

async function detail(sql: Sql, userId: string, id: string) {
  const rows = await sql<{ json: unknown }[]>`
    select json from cipher_details where id = ${id} and user_id = ${userId}`
  return rows[0]?.json
}
