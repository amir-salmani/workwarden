import { env } from 'cloudflare:test'
import { expect, it } from 'vitest'
import { connect } from '../src/db.ts'

// No sql.end() here on purpose. postgres.js's Cloudflare polyfill rejects its
// background read loop with "Stream was cancelled" when the socket closes,
// which vitest reports as an unhandled error. Miniflare tears the isolate down
// between files anyway; withDb() is what closes connections in the real Worker.

it('reaches Postgres through the Hyperdrive binding', async () => {
  const sql = connect(env)
  const rows = await sql`select 1 as one`
  expect(rows[0]?.one).toBe(1)
})

it('has the Phase 1 tables', async () => {
  const sql = connect(env)
  const rows = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = 'public' order by table_name`
  expect(rows.map((r) => r.table_name)).toEqual(
    expect.arrayContaining(['ciphers', 'devices', 'folders', 'users']),
  )
})
