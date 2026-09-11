import { env, SELF } from 'cloudflare:test'
import { connect } from '../src/db.ts'

export const ORIGIN = 'https://vault.example.com'

/** Emails used across the suite; their throttle counters must not carry over. */
const TEST_EMAILS = [
  'alice@example.com',
  'bob@example.com',
  'imported@example.com',
  'replay@example.com',
]

export async function resetDatabase() {
  const sql = connect(env)
  await sql`truncate users cascade`
  // Truncating Postgres does not touch Durable Object storage, so failed-login
  // counts from one test would lock out the next.
  await Promise.all(
    TEST_EMAILS.map((email) =>
      env.THROTTLE.get(env.THROTTLE.idFromName(`login:email:${email}`)).clear(),
    ),
  )
}

export type Registration = {
  email: string
  masterPasswordHash: string
  key: string
}

export const ALICE: Registration = {
  email: 'alice@example.com',
  masterPasswordHash: 'Y2xpZW50LXNpZGUtaGFzaA==',
  key: '2.protected-symmetric-key',
}

export async function register(who: Registration = ALICE) {
  return SELF.fetch(`${ORIGIN}/api/accounts/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: who.email,
      name: 'Alice',
      masterPasswordHash: who.masterPasswordHash,
      key: who.key,
      keys: { publicKey: 'pub', encryptedPrivateKey: '2.priv' },
      kdf: 0,
      kdfIterations: 600000,
    }),
  })
}

/**
 * `ip` sets cf-connecting-ip. The login throttle counts per address as well as
 * per account, so tests that share one address would lock each other out.
 */
export async function login(who: Registration = ALICE, ip?: string) {
  const body = new FormData()
  body.append('grant_type', 'password')
  body.append('username', who.email)
  body.append('password', who.masterPasswordHash)
  body.append('scope', 'api offline_access')
  body.append('deviceIdentifier', 'test-device')
  body.append('deviceName', 'vitest')
  body.append('deviceType', '9')
  return SELF.fetch(`${ORIGIN}/identity/connect/token`, {
    method: 'POST',
    body,
    headers: ip ? { 'cf-connecting-ip': ip } : {},
  })
}

export async function authHeaders(who: Registration = ALICE) {
  const res = await login(who, `auth-${Math.random()}`)
  const { access_token } = (await res.json()) as { access_token: string }
  return { Authorization: `Bearer ${access_token}` }
}
