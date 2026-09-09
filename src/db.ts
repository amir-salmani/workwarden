import type { MiddlewareHandler } from 'hono'
import postgres from 'postgres'
import type { App } from './app.ts'

export type Sql = ReturnType<typeof postgres>

// `fetch_types: false` skips postgres.js's type-introspection round trip on
// first query, which is pure latency here -- the schema uses no custom types.
export function connect(env: Env): Sql {
  return postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false })
}

// A client per request, never closed: Hyperdrive pools the underlying
// connection, and workerd ties the socket to the request anyway. Calling end()
// makes postgres.js's Cloudflare polyfill reject its detached read loop with
// "Stream was cancelled".
export function withDb(): MiddlewareHandler<App> {
  return async (c, next) => {
    const sql = connect(c.env)
    c.set('sql', sql)
    await next()
  }
}
