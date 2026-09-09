import { SELF } from 'cloudflare:test'
import { expect, it } from 'vitest'

it('advertises its own endpoints', async () => {
  const res = await SELF.fetch('https://vault.example.com/api/config')
  expect(res.status).toBe(200)

  const body = (await res.json()) as {
    object: string
    server: { name: string }
    environment: { identity: string }
  }
  expect(body.object).toBe('config')
  expect(body.server.name).toBe('workwarden')
  expect(body.environment.identity).toBe('https://vault.example.com/identity')
})
