import { Hono } from 'hono'
import { z } from 'zod'
import type { App } from '../app.ts'
import { requireUser } from '../auth/session.ts'
import { type Db, now, touch, uuid } from '../db.ts'
import { apiError, insensitive } from '../http.ts'
import { type FolderRow, folderJson } from '../wire.ts'

export const folders = new Hono<App>()
folders.use('*', requireUser())

const folderInput = z.object({ name: z.string().min(1) })

folders.post('/', async (c) => {
  const parsed = folderInput.safeParse(insensitive(await c.req.json()))
  if (!parsed.success) return apiError(c, 'Folder name is required')

  const db = c.get('db')
  const user = c.get('user')
  const id = uuid()
  const at = now()
  await db.batch([
    db
      .prepare(
        'insert into folders (id, user_id, name, created_at, revision_date) values (?, ?, ?, ?, ?)',
      )
      .bind(id, user.id, parsed.data.name, at, at),
    touch(db, user.id, at),
  ])
  return c.json(await detail(db, user.id, id))
})

folders.on(['PUT', 'POST'], '/:id', async (c) => {
  const id = c.req.param('id')
  const parsed = folderInput.safeParse(insensitive(await c.req.json()))
  if (!parsed.success) return apiError(c, 'Folder name is required')

  const db = c.get('db')
  const user = c.get('user')
  const at = now()
  const [updated] = await db.batch([
    db
      .prepare('update folders set name = ?, revision_date = ? where id = ? and user_id = ?')
      .bind(parsed.data.name, at, id, user.id),
    touch(db, user.id, at),
  ])
  if (!updated?.meta.changes) return apiError(c, 'Folder not found', 404)
  return c.json(await detail(db, user.id, id))
})

// Ciphers in the folder survive it.
folders.delete('/:id', async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const id = c.req.param('id')
  await db.batch([
    db
      .prepare('update ciphers set folder_id = null where folder_id = ? and user_id = ?')
      .bind(id, user.id),
    db.prepare('delete from folders where id = ? and user_id = ?').bind(id, user.id),
    touch(db, user.id),
  ])
  return c.body(null, 200)
})

async function detail(db: Db, userId: string, id: string) {
  const row = await db
    .prepare('select * from folders where id = ? and user_id = ?')
    .bind(id, userId)
    .first<FolderRow>()
  return row ? folderJson(row) : undefined
}
