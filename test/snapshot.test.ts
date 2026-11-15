import {
  createExecutionContext,
  createScheduledController,
  env,
  SELF,
  waitOnExecutionContext,
} from 'cloudflare:test'
import { Decrypter } from 'age-encryption'
import { beforeEach, expect, it } from 'vitest'
import worker from '../src/index.ts'
import { restoreStatements, type VaultExport } from '../src/snapshot.ts'
import { ALICE, authHeaders, ORIGIN, register, resetDatabase } from './support.ts'

// Pairs with AGE_RECIPIENT in vitest.config.ts. Test-only; never used anywhere else.
const TEST_IDENTITY = 'AGE-SECRET-KEY-1HJA4U3N2796XAX098HLMZHY6ZDR4UXU4U0YD05ZUX2GVCHQ55CYSZ08GRW'

type Sync = {
  folders: { id: string }[]
  ciphers: { id: string; name: string; folderId: string | null }[]
}

async function seed() {
  const headers = { ...(await authHeaders()), 'content-type': 'application/json' }
  const folder = (await (
    await SELF.fetch(`${ORIGIN}/api/folders`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: '2.f' }),
    })
  ).json()) as { id: string }
  await SELF.fetch(`${ORIGIN}/api/ciphers`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: 1,
      name: '2.one',
      folderId: folder.id,
      login: { username: '2.u' },
      key: '2.ck',
    }),
  })
  await SELF.fetch(`${ORIGIN}/api/ciphers`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ type: 2, name: '2.note', secureNote: { type: 0 }, notes: '2.n' }),
  })
  return headers
}

async function sync(headers: Record<string, string>) {
  return (await (await SELF.fetch(`${ORIGIN}/api/sync`, { headers })).json()) as Sync
}

async function runCron() {
  const ctx = createExecutionContext()
  await worker.scheduled(createScheduledController({ cron: '17 3 * * *' }), env, ctx)
  await waitOnExecutionContext(ctx)
}

async function latestExport(): Promise<VaultExport> {
  const user = await env.DB.prepare('select id from users').first<{ id: string }>()
  const obj = await env.SNAPSHOTS.get(`${user?.id}/latest.json.age`)
  expect(obj).not.toBeNull()
  const decrypter = new Decrypter()
  decrypter.addIdentity(TEST_IDENTITY)
  if (!obj) throw new Error('no snapshot')
  const text = await decrypter.decrypt(new Uint8Array(await obj.arrayBuffer()), 'text')
  return JSON.parse(text) as VaultExport
}

beforeEach(async () => {
  await resetDatabase()
  await register()
})

it('writes an age-encrypted export to R2 on the cron, readable only with the identity', async () => {
  await seed()
  await runCron()

  const user = await env.DB.prepare('select id from users').first<{ id: string }>()
  const listed = await env.SNAPSHOTS.list({ prefix: `${user?.id}/` })
  expect(listed.objects.map((o) => o.key.split('/')[1])).toEqual(
    expect.arrayContaining([
      'latest.json.age',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}\.json\.age$/),
    ]),
  )
  const latest = await env.SNAPSHOTS.get(`${user?.id}/latest.json.age`)
  const raw = (await latest?.text()) ?? ''
  expect(raw.startsWith('age-encryption.org/v1')).toBe(true)
  expect(raw).not.toContain('2.one')

  const exp = await latestExport()
  expect(exp.encrypted).toBe(true)
  expect(exp.workwarden.account.email).toBe(ALICE.email)
  expect(exp.workwarden.account.key).toBe(ALICE.key)
  expect(exp.folders).toHaveLength(1)
  expect(exp.items).toHaveLength(2)
  const one = exp.items.find((i) => i.name === '2.one')
  expect(one).toMatchObject({
    type: 1,
    folderId: exp.folders[0]?.id,
    key: '2.ck',
    collectionIds: null,
  })
  expect(one).not.toHaveProperty('edit')
  expect(one).not.toHaveProperty('permissions')
})

it('restores an export into an empty database and the client sees the same vault', async () => {
  const headers = await seed()
  const before = await sync(headers)
  await runCron()
  const exp = await latestExport()

  await resetDatabase()
  await env.DB.batch(restoreStatements(env.DB, exp))

  // Old tokens are dead (fresh security stamp); a fresh login works with the
  // same password hash, because the pepper is the same.
  expect((await SELF.fetch(`${ORIGIN}/api/sync`, { headers })).status).toBe(401)
  const after = await sync({ ...(await authHeaders()), 'content-type': 'application/json' })
  expect(after.folders).toEqual(before.folders.map((f) => expect.objectContaining({ id: f.id })))
  expect(after.ciphers.map((c) => [c.id, c.name, c.folderId]).sort()).toEqual(
    before.ciphers.map((c) => [c.id, c.name, c.folderId]).sort(),
  )
})
