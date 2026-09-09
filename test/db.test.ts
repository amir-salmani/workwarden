import { env } from 'cloudflare:test'
import { expect, it } from 'vitest'
import { connect } from '../src/db.ts'

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
