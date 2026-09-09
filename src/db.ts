import type { MiddlewareHandler } from 'hono'
import postgres from 'postgres'
import type { App } from './app.ts'

export type Sql = ReturnType<typeof postgres>

// `fetch_types: false` skips postgres.js's type-introspection round trip on
// first query, which is pure latency here -- the schema uses no custom types.
export function connect(env: Env): Sql {
  return postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false })
}

// One connection per request, closed after the response is sent. Closing inside
// the handler would block it; waitUntil lets the response go first.
export function withDb(): MiddlewareHandler<App> {
  return async (c, next) => {
    const sql = connect(c.env)
    c.set('sql', sql)
    try {
      await next()
    } finally {
      c.executionCtx.waitUntil(sql.end())
    }
  }
}
