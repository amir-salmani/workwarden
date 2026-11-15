import type { MiddlewareHandler } from 'hono'
import type { App } from './app.ts'

export type Db = D1Database

export function withDb(): MiddlewareHandler<App> {
  return async (c, next) => {
    c.set('db', c.env.DB)
    await next()
  }
}

export const now = () => new Date().toISOString()
export const uuid = () => crypto.randomUUID()

/** Bumps the user's revision date; clients poll it to decide whether to sync. */
export function touch(db: Db, userId: string, at = now()) {
  return db.prepare('update users set revision_date = ? where id = ?').bind(at, userId)
}
