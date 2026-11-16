import { SELF } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { signupAllowed } from '../src/routes/accounts.ts'
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

it('sends every login field in exactly one casing', async () => {
  await register()
  const body = (await (await login()).json()) as Record<string, unknown>
  const lower = new Set(Object.keys(body).map((k) => k.toLowerCase()))
  expect(lower.size).toBe(Object.keys(body).length)
  expect(body.Key).toBe(ALICE.key)
  expect(body).not.toHaveProperty('key')
})

it('records the user key id and hands it back on the next login', async () => {
  await register()
  const auth = await authHeaders()
  const first = (await (await login()).json()) as {
    UserDecryptionOptions: { userKeyId: string | null }
  }
  expect(first.UserDecryptionOptions.userKeyId).toBeNull()

  const res = await SELF.fetch(`${ORIGIN}/api/accounts/key-management/user-key-id`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ userKeyId: 'key-id-1' }),
  })
  expect(res.status).toBe(200)

  const next = (await (await login()).json()) as { UserDecryptionOptions: { userKeyId: string } }
  expect(next.UserDecryptionOptions.userKeyId).toBe('key-id-1')
})

it('answers the device and hint probes the mobile apps make', async () => {
  await register()
  const auth = await authHeaders()
  const known = (id: string, email: string) =>
    SELF.fetch(`${ORIGIN}/api/devices/knowndevice`, {
      headers: { 'X-Device-Identifier': id, 'X-Request-Email': btoa(email) },
    })
  expect(await (await known('test-device', ALICE.email)).json()).toBe(true)
  expect(await (await known('other-device', ALICE.email)).json()).toBe(false)
  expect(await (await known('test-device', 'nobody@example.com')).json()).toBe(false)
  expect(
    (
      await SELF.fetch(`${ORIGIN}/api/devices/identifier/test-device/token`, {
        method: 'PUT',
        headers: auth,
      })
    ).status,
  ).toBe(200)
  expect(
    (await SELF.fetch(`${ORIGIN}/api/devices/identifier/test-device/token`, { method: 'PUT' }))
      .status,
  ).toBe(401)
  expect(
    (
      await SELF.fetch(`${ORIGIN}/api/accounts/password-hint`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"email":"x@y.test"}',
      })
    ).status,
  ).toBe(200)
})

it('answers prelogin in both the pre- and post-2026.10 client shapes', async () => {
  await register()
  const res = await SELF.fetch(`${ORIGIN}/identity/accounts/prelogin/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'Alice@Example.com' }),
  })
  expect(await res.json()).toMatchObject({
    kdf: 0,
    kdfIterations: 600000,
    kdfSettings: { kdfType: 0, iterations: 600000, memory: null, parallelism: null },
    salt: 'alice@example.com',
  })
})

it('accepts the capitalised field names older clients send', async () => {
  const res = await SELF.fetch(`${ORIGIN}/api/accounts/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      Email: ALICE.email,
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

it('changes the master password and logs other devices out', async () => {
  await register()
  const auth = await authHeaders()
  const before = await login(ALICE)
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
  expect((await login(ALICE)).status).toBe(400)
  const after = await login({ ...ALICE, masterPasswordHash: 'bmV3LWhhc2g=' })
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
  expect((await login(ALICE)).status).toBe(200)
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
    }),
  })
  expect(res.status).toBe(200)

  // The stamp rotated, so a fresh login is needed to see the result.
  const fresh = await login(ALICE)
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

it('turns away every address but the owner', async () => {
  const stranger = await SELF.fetch(`${ORIGIN}/api/accounts/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'stranger@elsewhere.test',
      masterPasswordHash: 'aGFzaA==',
      key: '2.key',
      kdf: 0,
      kdfIterations: 600000,
    }),
  })
  expect(stranger.status).toBe(400)
  expect(await stranger.json()).toMatchObject({ message: 'Registration is closed on this server' })
})

it('reads the owner address case-insensitively, and closed when unset', () => {
  expect(signupAllowed('Alice@Example.com', 'alice@example.com')).toBe(true)
  expect(signupAllowed(' alice@example.com ', 'alice@example.com')).toBe(true)
  expect(signupAllowed('alice@example.com', 'bob@example.com')).toBe(false)
  expect(signupAllowed('', 'alice@example.com')).toBe(false)
  expect(signupAllowed(undefined, 'alice@example.com')).toBe(false)
})
