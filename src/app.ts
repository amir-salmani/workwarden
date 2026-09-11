import { Hono } from 'hono'
import { type Sql, withDb } from './db.ts'
import { accounts } from './routes/accounts.ts'
import { attachments } from './routes/attachments.ts'
import { ciphers } from './routes/ciphers.ts'
import { config } from './routes/config.ts'
import { folders } from './routes/folders.ts'
import { home } from './routes/home.ts'
import { icons } from './routes/icons.ts'
import { identity } from './routes/identity.ts'
import { sends } from './routes/sends.ts'
import { sync } from './routes/sync.ts'
import type { User } from './users.ts'

export type App = {
  Bindings: Env
  Variables: { sql: Sql; user: User; deviceId: string }
}

// Importable from plain Node so scripts/route-surface.mjs can read app.routes
// off the real app rather than regex the source.
export function createApp() {
  const app = new Hono<App>()
  app.route('/', home)
  app.use('/api/*', withDb())
  app.route('/api', config)
  app.route('/api/accounts', accounts)
  app.route('/api/sync', sync)
  app.route('/api/ciphers', ciphers)
  app.route('/api/folders', folders)
  app.route('/api/sends', sends)
  // Outside /api: the URL handed to clients in a cipher's attachment list.
  app.use('/attachments/*', withDb())
  app.route('/attachments', attachments)
  // No auth: a site icon is public, and the client fetches these before unlock.
  app.route('/icons', icons)
  app.route('/identity', identity)
  return app
}

export default createApp()
