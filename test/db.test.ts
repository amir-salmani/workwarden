import { env } from 'cloudflare:test'
import { expect, it } from 'vitest'

it('reaches D1 through the binding, with the schema applied', async () => {
  const row = await env.DB.prepare('select count(*) as n from users').first<{ n: number }>()
  expect(row?.n).toBe(0)
})
