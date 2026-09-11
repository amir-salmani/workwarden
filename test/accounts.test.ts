import { env, SELF } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { randomSalt } from '../src/auth/kdf.ts'
import { connect } from '../src/db.ts'
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

it('answers a bodyless token request with 400, not 500', async () => {
  const res = await SELF.fetch(`${ORIGIN}/identity/connect/token`, { method: 'POST' })
  expect(res.status).toBe(400)
  expect(await res.json()).toMatchObject({ error: 'invalid_request' })
})

it('serves a page at the root that is not a login form', async () => {
  const res = await SELF.fetch(`${ORIGIN}/`)
  expect(res.status).toBe(200)
  const html = await res.text()
  expect(html).toContain('workwarden')
  expect(html).not.toContain('<input')
  expect(html).not.toContain('<script')
})

it('refuses to log in to an imported account until it is claimed, then allows it', async () => {
  const sql = connect(env)
  const salt = randomSalt()
  await sql`
    insert into users (email, name, password_hash, salt, akey, claim_token)
    values ('imported@example.com', 'Imported', null, ${salt}, '2.key', 'claim-token-long-enough')`

  const before = await login({ ...ALICE, email: 'imported@example.com' })
  expect(before.status).toBe(400)

  const claim = await SELF.fetch(`${ORIGIN}/api/accounts/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'imported@example.com',
      token: 'claim-token-long-enough',
      masterPasswordHash: ALICE.masterPasswordHash,
    }),
  })
  expect(claim.status).toBe(200)

  const after = await login({ ...ALICE, email: 'imported@example.com' })
  expect(after.status).toBe(200)
})

it('refuses a wrong claim token, and a replayed one', async () => {
  const sql = connect(env)
  await sql`
    insert into users (email, password_hash, salt, akey, claim_token)
    values ('replay@example.com', null, ${randomSalt()}, '2.key', 'the-real-claim-token')`

  const claimWith = (token: string) =>
    SELF.fetch(`${ORIGIN}/api/accounts/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'replay@example.com',
        token,
        masterPasswordHash: ALICE.masterPasswordHash,
      }),
    })

  expect((await claimWith('the-wrong-claim-tokn')).status).toBe(400)
  expect((await claimWith('the-real-claim-token')).status).toBe(200)
  expect((await claimWith('the-real-claim-token')).status).toBe(400)
})

it('changes the master password and logs other devices out', async () => {
  await register()
  const auth = await authHeaders()
  const before = await login(ALICE, '10.1.0.1')
  expect(before.status).toBe(200)

  const res = await SELF.fetch(`${ORIGIN}/api/accounts/password`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      masterPasswordHash: ALICE.masterPasswordHash,
      newMasterPasswordHash: 'bmV3LWhhc2g=',
      key: '2.rewrapped-user-key',
    }),
  })
  expect(res.status).toBe(200)

  // The old password stops working, the new one starts.
  expect((await login(ALICE, '10.1.0.2')).status).toBe(400)
  const after = await login({ ...ALICE, masterPasswordHash: 'bmV3LWhhc2g=' }, '10.1.0.3')
  expect(after.status).toBe(200)
  expect(((await after.json()) as { Key: string }).Key).toBe('2.rewrapped-user-key')

  // The token issued before the change no longer works.
  expect((await SELF.fetch(`${ORIGIN}/api/accounts/profile`, { headers: auth })).status).toBe(401)
})

it('refuses a password change that does not prove the current password', async () => {
  await register()
  const auth = await authHeaders()
  const res = await SELF.fetch(`${ORIGIN}/api/accounts/password`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      masterPasswordHash: 'not-the-current-one',
      newMasterPasswordHash: 'bmV3',
      key: '2.k',
    }),
  })
  expect(res.status).toBe(400)
  expect((await login(ALICE, '10.1.0.4')).status).toBe(200)
})

it('rotates the account key and every item with it, in one transaction', async () => {
  await register()
  const auth = await authHeaders()
  const headers = { ...auth, 'content-type': 'application/json' }

  const created = await SELF.fetch(`${ORIGIN}/api/ciphers`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ type: 1, name: '2.old-wrapping', login: { username: '2.u' } }),
  })
  const { id } = (await created.json()) as { id: string }
  const folder = await SELF.fetch(`${ORIGIN}/api/folders`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: '2.old-folder' }),
  })
  const folderId = ((await folder.json()) as { id: string }).id

  const res = await SELF.fetch(`${ORIGIN}/api/accounts/key`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      masterPasswordHash: ALICE.masterPasswordHash,
      key: '2.rotated-user-key',
      ciphers: [{ id, type: 1, name: '2.new-wrapping', login: { username: '2.u2' } }],
      folders: [{ id: folderId, name: '2.new-folder' }],
      sends: [],
    }),
  })
  expect(res.status).toBe(200)

  // The stamp rotated, so a fresh login is needed to see the result.
  const fresh = await login(ALICE, '10.1.0.5')
  const { access_token } = (await fresh.json()) as { access_token: string }
  const sync = (await (
    await SELF.fetch(`${ORIGIN}/api/sync`, { headers: { Authorization: `Bearer ${access_token}` } })
  ).json()) as {
    profile: { key: string }
    ciphers: { name: string }[]
    folders: { name: string }[]
  }
  expect(sync.profile.key).toBe('2.rotated-user-key')
  expect(sync.ciphers[0]?.name).toBe('2.new-wrapping')
  expect(sync.folders[0]?.name).toBe('2.new-folder')
})
