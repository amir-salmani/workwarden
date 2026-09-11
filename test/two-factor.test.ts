import { SELF } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { codeFor, stepFor } from '../src/auth/totp.ts'
import { ALICE, authHeaders, login, ORIGIN, register, resetDatabase } from './support.ts'

let auth: Record<string, string>
let ip: string

beforeEach(async () => {
  await resetDatabase()
  await register()
  auth = await authHeaders()
  ip = `10.2.0.${Math.floor(Math.random() * 1e6)}`
})

const api = (path: string, body: unknown) =>
  SELF.fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

async function enable() {
  const got = await api('/api/two-factor/get-authenticator', {
    masterPasswordHash: ALICE.masterPasswordHash,
  })
  const { key } = (await got.json()) as { key: string }
  const res = await api('/api/two-factor/authenticator', {
    masterPasswordHash: ALICE.masterPasswordHash,
    key,
    token: await codeFor(key, stepFor()),
  })
  expect(res.status).toBe(200)
  return { key, recoveryCode: ((await res.json()) as { recoveryCode: string }).recoveryCode }
}

it('hands out a secret without enabling anything yet', async () => {
  const res = await api('/api/two-factor/get-authenticator', {
    masterPasswordHash: ALICE.masterPasswordHash,
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { enabled: boolean; key: string }
  expect(body.enabled).toBe(false)
  expect(body.key.length).toBeGreaterThan(15)

  // Still a plain login: nothing is enforced until a code proves it works.
  expect((await login(ALICE, ip)).status).toBe(200)
})

it('refuses to enable without a working code', async () => {
  const got = await api('/api/two-factor/get-authenticator', {
    masterPasswordHash: ALICE.masterPasswordHash,
  })
  const { key } = (await got.json()) as { key: string }
  const res = await api('/api/two-factor/authenticator', {
    masterPasswordHash: ALICE.masterPasswordHash,
    key,
    token: '000000',
  })
  expect(res.status).toBe(400)
  expect((await login(ALICE, ip)).status).toBe(200)
})

it('requires a code once enabled, and tells the client which provider', async () => {
  const { key } = await enable()

  const challenged = await login(ALICE, ip)
  expect(challenged.status).toBe(400)
  expect(await challenged.json()).toMatchObject({
    error: 'invalid_grant',
    TwoFactorProviders: ['0'],
  })

  // Enabling consumed the current step, so the next code is the first usable one.
  const ok = await loginWithCode(await codeFor(key, stepFor() + 1))
  expect(ok.status).toBe(200)
})

it('will not accept the same code twice', async () => {
  const { key } = await enable()
  const code = await codeFor(key, stepFor() + 1)

  expect((await loginWithCode(code)).status).toBe(200)
  // Valid for its whole window, so replay has to be blocked explicitly.
  expect((await loginWithCode(code)).status).toBe(400)
})

it('accepts a recovery code once, and turns the factor off', async () => {
  const { recoveryCode } = await enable()

  expect((await loginWithCode(recoveryCode)).status).toBe(200)
  // Used up: the account is reachable with the password alone again.
  expect((await login(ALICE, ip)).status).toBe(200)
})

it('will not disable itself without the master password', async () => {
  await enable()
  const res = await api('/api/two-factor/disable', { masterPasswordHash: 'wrong', type: 0 })
  expect(res.status).toBe(400)

  // A stolen session alone must not be able to strip the second factor.
  expect((await login(ALICE, ip)).status).toBe(400)
})

it('disables with the master password', async () => {
  await enable()
  const res = await api('/api/two-factor/disable', {
    masterPasswordHash: ALICE.masterPasswordHash,
    type: 0,
  })
  expect(res.status).toBe(200)
  expect((await login(ALICE, ip)).status).toBe(200)
})

function loginWithCode(token: string) {
  const body = new FormData()
  body.append('grant_type', 'password')
  body.append('username', ALICE.email)
  body.append('password', ALICE.masterPasswordHash)
  body.append('scope', 'api offline_access')
  body.append('deviceIdentifier', 'test-device')
  body.append('twoFactorToken', token)
  body.append('twoFactorProvider', '0')
  return SELF.fetch(`${ORIGIN}/identity/connect/token`, {
    method: 'POST',
    body,
    headers: { 'cf-connecting-ip': ip },
  })
}
