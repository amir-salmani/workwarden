import { Hono } from 'hono'
import { type Sql, withDb } from './db.ts'
import { accounts } from './routes/accounts.ts'
import { config } from './routes/config.ts'
import { identity } from './routes/identity.ts'
import type { User } from './users.ts'

export type App = {
  Bindings: Env
  Variables: { sql: Sql; user: User; deviceId: string }
}

// Importable from plain Node so scripts/route-surface.mjs can read app.routes
// off the real app rather than regex the source.
export function createApp() {
  const app = new Hono<App>()
  app.use('/api/*', withDb())
  app.route('/api', config)
  app.route('/api/accounts', accounts)
  app.route('/identity', identity)
  return app
}

export default createApp()
