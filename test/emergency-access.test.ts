import { env, SELF } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { connect } from '../src/db.ts'
import {
  ALICE,
  authHeaders,
  login,
  ORIGIN,
  type Registration,
  register,
  resetDatabase,
} from './support.ts'

const BOB: Registration = {
  email: 'bob@example.com',
  masterPasswordHash: 'Ym9iLWhhc2g=',
  key: '2.bob-key',
}

let alice: Record<string, string>
let bob: Record<string, string>

beforeEach(async () => {
  await resetDatabase()
  await register()
  await register(BOB)
  alice = await authHeaders()
  bob = await authHeaders(BOB)
})

const as = (who: Record<string, string>, path: string, init: RequestInit = {}) =>
  SELF.fetch(`${ORIGIN}${path}`, {
    ...init,
    headers: { ...who, 'content-type': 'application/json', ...(init.headers ?? {}) },
  })

const post = (who: Record<string, string>, path: string, body: unknown = {}) =>
  as(who, path, { method: 'POST', body: JSON.stringify(body) })

/** Alice trusts Bob, and hands him the vault key wrapped to his public key. */
async function grant(type: number) {
  const invited = await post(alice, '/api/emergency-access/invite', {
    email: BOB.email,
    type,
    waitTimeDays: 2,
  })
  expect(invited.status).toBe(200)

  const mine = (await (await as(alice, '/api/emergency-access/trusted')).json()) as {
    data: { id: string; status: number }[]
  }
  const id = mine.data[0]?.id as string
  expect(
    await post(alice, `/api/emergency-access/${id}/confirm`, { key: '4.wrapped-for-bob' }),
  ).toHaveProperty('status', 200)
  return id
}

it('invites someone who already has an account, and shows it on both sides', async () => {
  const id = await grant(1)

  const trusted = (await (await as(alice, '/api/emergency-access/trusted')).json()) as {
    data: { id: string; status: number; granteeId: string; object: string }[]
  }
  expect(trusted.data[0]).toMatchObject({ id, status: 2, object: 'emergencyAccessGranteeDetails' })

  const granted = (await (await as(bob, '/api/emergency-access/granted')).json()) as {
    data: { id: string; email: string; object: string }[]
  }
  expect(granted.data[0]).toMatchObject({
    id,
    email: ALICE.email,
    object: 'emergencyAccessGrantorDetails',
  })
})

it('refuses an invite to a stranger, to yourself, or twice', async () => {
  const stranger = await post(alice, '/api/emergency-access/invite', {
    email: 'nobody@example.com',
    type: 0,
    waitTimeDays: 2,
  })
  expect(stranger.status).toBe(400)

  const self = await post(alice, '/api/emergency-access/invite', {
    email: ALICE.email,
    type: 0,
    waitTimeDays: 2,
  })
  expect(self.status).toBe(400)

  await grant(0)
  const again = await post(alice, '/api/emergency-access/invite', {
    email: BOB.email,
    type: 0,
    waitTimeDays: 2,
  })
  expect(again.status).toBe(400)
})

it('holds the grantee off until the grantor approves', async () => {
  const id = await grant(1)
  expect((await post(bob, `/api/emergency-access/${id}/takeover`)).status).toBe(404)

  expect((await post(bob, `/api/emergency-access/${id}/initiate`)).status).toBe(200)
  expect((await post(bob, `/api/emergency-access/${id}/takeover`)).status).toBe(404)

  expect((await post(alice, `/api/emergency-access/${id}/approve`)).status).toBe(200)
  const takeover = await post(bob, `/api/emergency-access/${id}/takeover`)
  expect(takeover.status).toBe(200)
  expect(await takeover.json()).toMatchObject({
    keyEncrypted: '4.wrapped-for-bob',
    kdf: 0,
    kdfIterations: 600000,
    object: 'emergencyAccessTakeover',
  })
})

it('lets the wait time approve it when the grantor never answers', async () => {
  const id = await grant(1)
  await post(bob, `/api/emergency-access/${id}/initiate`)
  expect((await post(bob, `/api/emergency-access/${id}/takeover`)).status).toBe(404)

  await connect(env)`
    update emergency_accesses set recovery_initiated_at = now() - interval '3 days'`
  expect((await post(bob, `/api/emergency-access/${id}/takeover`)).status).toBe(200)

  // And the grantor's own list says so, without anything having run in between.
  const trusted = (await (await as(alice, '/api/emergency-access/trusted')).json()) as {
    data: { status: number }[]
  }
  expect(trusted.data[0]?.status).toBe(4)
})

it('stops the clock when the grantor rejects', async () => {
  const id = await grant(1)
  await post(bob, `/api/emergency-access/${id}/initiate`)
  expect((await post(alice, `/api/emergency-access/${id}/reject`)).status).toBe(200)

  await connect(env)`
    update emergency_accesses set recovery_initiated_at = now() - interval '30 days'`
  expect((await post(bob, `/api/emergency-access/${id}/takeover`)).status).toBe(404)
})

it('resets the grantor’s password on takeover, and logs their devices out', async () => {
  const id = await grant(1)
  await post(bob, `/api/emergency-access/${id}/initiate`)
  await post(alice, `/api/emergency-access/${id}/approve`)

  const reset = await post(bob, `/api/emergency-access/${id}/password`, {
    newMasterPasswordHash: 'bmV3LWhhc2g=',
    key: '2.rewrapped-key',
  })
  expect(reset.status).toBe(200)

  // The old token dies with the security stamp; the old password no longer works.
  expect((await as(alice, '/api/sync')).status).toBe(401)
  expect((await login(ALICE, 'ea-old')).status).toBe(400)
  expect((await login({ ...ALICE, masterPasswordHash: 'bmV3LWhhc2g=' }, 'ea-new')).status).toBe(200)
})

it('gives a view grant the vault and nothing else', async () => {
  await as(alice, '/api/ciphers', {
    method: 'POST',
    body: JSON.stringify({ type: 1, name: '2.encrypted-name', login: { username: '2.user' } }),
  })
  const id = await grant(0)
  await post(bob, `/api/emergency-access/${id}/initiate`)
  await post(alice, `/api/emergency-access/${id}/approve`)

  const view = await post(bob, `/api/emergency-access/${id}/view`)
  expect(view.status).toBe(200)
  const body = (await view.json()) as { ciphers: { name: string }[]; keyEncrypted: string }
  expect(body.ciphers).toHaveLength(1)
  expect(body.ciphers[0]?.name).toBe('2.encrypted-name')
  expect(body.keyEncrypted).toBe('4.wrapped-for-bob')

  // A view grant cannot become a takeover by asking for one.
  expect((await post(bob, `/api/emergency-access/${id}/takeover`)).status).toBe(404)
})

it('lets either side walk away', async () => {
  const id = await grant(0)
  expect((await as(bob, `/api/emergency-access/${id}`, { method: 'DELETE' })).status).toBe(200)

  const trusted = (await (await as(alice, '/api/emergency-access/trusted')).json()) as {
    data: unknown[]
  }
  expect(trusted.data).toHaveLength(0)
})
