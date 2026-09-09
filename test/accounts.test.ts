import { SELF } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { ALICE, authHeaders, login, ORIGIN, register, resetDatabase } from './support.ts'

beforeEach(resetDatabase)

it('registers, logs in, and returns the vault key', async () => {
  expect((await register()).status).toBe(200)

  const res = await login()
  expect(res.status).toBe(200)

  const body = (await res.json()) as Record<string, unknown>
  expect(body.token_type).toBe('Bearer')
  expect(body.Key).toBe(ALICE.key)
  expect(body.PrivateKey).toBe('2.priv')
  expect(body.KdfIterations).toBe(600000)
  expect(typeof body.refresh_token).toBe('string')
})

it('refuses a second registration of the same email', async () => {
  await register()
  expect((await register()).status).toBe(400)
})

it('rejects the wrong password', async () => {
  await register()
  const res = await login({ ...ALICE, masterPasswordHash: 'wrong' })
  expect(res.status).toBe(400)
  expect(await res.json()).toMatchObject({ error: 'invalid_grant' })
})

it('gives an unknown email the default KDF rather than an error', async () => {
  const res = await SELF.fetch(`${ORIGIN}/api/accounts/prelogin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'nobody@example.com' }),
  })
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ kdf: 0, kdfIterations: 600000 })
})

it('accepts the capitalised field names older clients send', async () => {
  const res = await SELF.fetch(`${ORIGIN}/api/accounts/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      Email: 'bob@example.com',
      MasterPasswordHash: 'aGFzaA==',
      Key: '2.key',
      Kdf: 0,
      KdfIterations: 600000,
    }),
  })
  expect(res.status).toBe(200)
})

it('serves the profile to a bearer token and refuses without one', async () => {
  await register()
  const res = await SELF.fetch(`${ORIGIN}/api/accounts/profile`, {
    headers: await authHeaders(),
  })
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ email: ALICE.email, object: 'profile' })

  expect((await SELF.fetch(`${ORIGIN}/api/accounts/profile`)).status).toBe(401)
})
