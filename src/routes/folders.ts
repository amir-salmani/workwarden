import { Hono } from 'hono'
import { z } from 'zod'
import type { App } from '../app.ts'
import { requireUser } from '../auth/session.ts'
import type { Sql } from '../db.ts'
import { apiError, insensitive } from '../http.ts'

export const folders = new Hono<App>()
folders.use('*', requireUser())

const folderInput = z.object({ name: z.string().min(1) })

folders.post('/', async (c) => {
  const parsed = folderInput.safeParse(insensitive(await c.req.json()))
  if (!parsed.success) return apiError(c, 'Folder name is required')

  const rows = await c.get('sql')<{ id: string }[]>`
    insert into folders (user_id, name) values (${c.get('user').id}, ${parsed.data.name})
    returning id`
  const id = rows[0]?.id
  if (!id) return apiError(c, 'Could not create folder', 500)
  return c.json(await detail(c.get('sql'), c.get('user').id, id))
})

folders.on(['PUT', 'POST'], '/:id', async (c) => {
  const id = c.req.param('id')
  const parsed = folderInput.safeParse(insensitive(await c.req.json()))
  if (!parsed.success) return apiError(c, 'Folder name is required')

  const rows = await c.get('sql')<{ id: string }[]>`
    update folders set name = ${parsed.data.name}, revision_date = now()
    where id = ${id} and user_id = ${c.get('user').id} returning id`
  if (!rows[0]) return apiError(c, 'Folder not found', 404)
  return c.json(await detail(c.get('sql'), c.get('user').id, id))
})

// Ciphers in the folder survive it; folder_id is set null by the FK.
folders.delete('/:id', async (c) => {
  await c.get('sql')`
    delete from folders where id = ${c.req.param('id')} and user_id = ${c.get('user').id}`
  return c.body(null, 200)
})

async function detail(sql: Sql, userId: string, id: string) {
  const rows = await sql<{ json: unknown }[]>`
    select json from folder_details where id = ${id} and user_id = ${userId}`
  return rows[0]?.json
}
