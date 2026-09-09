import { env, SELF } from 'cloudflare:test'
import { beforeAll, expect, it } from 'vitest'
import { deriveAuthHash } from '../src/auth/kdf.ts'

const EMAIL = 'spike@example.com'
const CLIENT_HASH = 'aGFzaC1mcm9tLXRoZS1jbGllbnQ='

beforeAll(async () => {
  env.SPIKE_AUTH_HASH = await deriveAuthHash(CLIENT_HASH, EMAIL, env.AUTH_PEPPER)
})

function grant(fields: Record<string, string>) {
  const body = new FormData()
  for (const [k, v] of Object.entries(fields)) body.append(k, v)
  return SELF.fetch('https://vault.example.com/identity/connect/token', { method: 'POST', body })
}

it('issues a token for the right password', async () => {
  const res = await grant({
    grant_type: 'password',
    username: EMAIL,
    password: CLIENT_HASH,
    scope: 'api offline_access',
    deviceIdentifier: 'device-1',
  })
  expect(res.status).toBe(200)

  const body = (await res.json()) as { access_token: string; token_type: string }
  expect(body.token_type).toBe('Bearer')
  expect(body.access_token.split('.')).toHaveLength(3)
})

it('rejects the wrong password without leaking which field was wrong', async () => {
  const res = await grant({
    grant_type: 'password',
    username: EMAIL,
    password: 'wrong',
    scope: 'api offline_access',
    deviceIdentifier: 'device-1',
  })
  expect(res.status).toBe(400)
  expect(await res.json()).toMatchObject({ error: 'invalid_grant' })
})

it('rejects grant types it does not implement', async () => {
  const res = await grant({ grant_type: 'client_credentials' })
  expect(res.status).toBe(400)
  expect(await res.json()).toMatchObject({ error: 'unsupported_grant_type' })
})
