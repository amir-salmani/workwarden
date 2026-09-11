import { env, SELF } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { LOGIN_LIMIT } from '../src/throttle.ts'
import { ALICE, login, ORIGIN, register, resetDatabase } from './support.ts'

beforeEach(async () => {
  await resetDatabase()
  await register()
})

// Each test gets its own source address so one cannot lock out another.
let ip: string
beforeEach(() => {
  ip = `10.0.0.${Math.floor(Math.random() * 1e6)}`
})

const wrongPassword = () => login({ ...ALICE, masterPasswordHash: 'wrong' }, ip)

it('locks out after repeated failures and says how long to wait', async () => {
  for (let i = 0; i < LOGIN_LIMIT; i++) {
    expect((await wrongPassword()).status, `attempt ${i + 1}`).toBe(400)
  }

  const blocked = await wrongPassword()
  expect(blocked.status).toBe(429)
  expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
})

it('locks out the right password too, so guessing cannot be confirmed', async () => {
  for (let i = 0; i < LOGIN_LIMIT; i++) await wrongPassword()
  // An attacker who finds the password on attempt 11 must still wait.
  expect((await login(ALICE, ip)).status).toBe(429)
})

it('forgets failures once a login succeeds', async () => {
  for (let i = 0; i < LOGIN_LIMIT - 1; i++) await wrongPassword()
  expect((await login(ALICE, ip)).status).toBe(200)

  // The counter is clear, so a fresh run of typos is tolerated again.
  for (let i = 0; i < LOGIN_LIMIT - 1; i++) {
    expect((await wrongPassword()).status).toBe(400)
  }
  expect((await login(ALICE, ip)).status).toBe(200)
})

it('does not lock one account out because another was attacked', async () => {
  const bob = { email: 'bob@example.com', masterPasswordHash: 'Ym9i', key: '2.bobkey' }
  await register(bob)

  for (let i = 0; i < LOGIN_LIMIT + 1; i++) {
    await login({ ...bob, masterPasswordHash: 'wrong' }, ip)
  }
  expect((await login({ ...bob, masterPasswordHash: 'wrong' }, ip)).status).toBe(429)

  // A different address is unaffected: attacking bob must not lock alice out
  // for everyone, only for the source doing the attacking.
  expect((await login(ALICE, '10.0.0.99')).status).toBe(200)
})

it('answers 429 in the shape a client can read', async () => {
  for (let i = 0; i < LOGIN_LIMIT; i++) await wrongPassword()
  const blocked = await wrongPassword()
  expect(await blocked.json()).toMatchObject({ error: 'invalid_grant' })
})

it('leaves the throttle out of the way of an ordinary login', async () => {
  const res = await SELF.fetch(`${ORIGIN}/api/config`)
  expect(res.status).toBe(200)
  expect((await login(ALICE, ip)).status).toBe(200)
})
