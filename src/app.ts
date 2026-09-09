import { Hono } from 'hono'
import { config } from './routes/config.ts'
import { identity } from './routes/identity.ts'

export type App = { Bindings: Env }

// Importable from plain Node so scripts/route-surface.mjs can read app.routes
// off the real app rather than regex the source.
export function createApp() {
  const app = new Hono<App>()
  app.route('/api', config)
  app.route('/identity', identity)
  return app
}

export default createApp()
