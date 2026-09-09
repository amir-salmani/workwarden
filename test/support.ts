import { env, SELF } from 'cloudflare:test'
import { connect } from '../src/db.ts'

export const ORIGIN = 'https://vault.example.com'

export async function resetDatabase() {
  const sql = connect(env)
  await sql`truncate users cascade`
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

export async function login(who: Registration = ALICE) {
  const body = new FormData()
  body.append('grant_type', 'password')
  body.append('username', who.email)
  body.append('password', who.masterPasswordHash)
  body.append('scope', 'api offline_access')
  body.append('deviceIdentifier', 'test-device')
  body.append('deviceName', 'vitest')
  body.append('deviceType', '9')
  const res = await SELF.fetch(`${ORIGIN}/identity/connect/token`, { method: 'POST', body })
  return res
}

export async function authHeaders(who: Registration = ALICE) {
  const res = await login(who)
  const { access_token } = (await res.json()) as { access_token: string }
  return { Authorization: `Bearer ${access_token}` }
}
