import { Hono } from 'hono'
import type { App } from '../app.ts'
import { requireUser } from '../auth/session.ts'
import { masterPasswordUnlock } from '../auth/unlock.ts'
import { type CipherRow, cipherJson, type FolderRow, folderJson } from '../wire.ts'
import { profile } from './accounts.ts'

export const sync = new Hono<App>()

sync.get('/', requireUser(), async (c) => {
  const db = c.get('db')
  const user = c.get('user')
  const [folders, ciphers] = await db.batch([
    db.prepare('select * from folders where user_id = ? order by id').bind(user.id),
    db.prepare('select * from ciphers where user_id = ? order by id').bind(user.id),
  ])
  return c.json({
    profile: profile(user),
    folders: ((folders?.results ?? []) as FolderRow[]).map(folderJson),
    ciphers: ((ciphers?.results ?? []) as CipherRow[]).map(cipherJson),
    collections: [],
    domains: null,
    policies: [],
    sends: [],
    userDecryption: { masterPasswordUnlock: masterPasswordUnlock(user), v2UpgradeToken: null },
    object: 'sync',
  })
})
