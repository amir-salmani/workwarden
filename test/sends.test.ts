import { SELF } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { ALICE, authHeaders, ORIGIN, register, resetDatabase } from './support.ts'

let auth: Record<string, string>

beforeEach(async () => {
  await resetDatabase()
  await register()
  auth = await authHeaders()
})

const api = (path: string, init: RequestInit = {}) =>
  SELF.fetch(`${ORIGIN}${path}`, {
    ...init,
    headers: { ...auth, 'content-type': 'application/json', ...(init.headers ?? {}) },
  })

const aSend = {
  type: 0,
  name: '2.shared-note',
  notes: null,
  key: '2.send-key',
  text: { text: '2.the-secret', hidden: false },
  deletionDate: '2030-01-01T00:00:00.000Z',
  maxAccessCount: 5,
}

it('creates a send, lists it, and carries it in sync', async () => {
  const created = await api('/api/sends', { method: 'POST', body: JSON.stringify(aSend) })
  expect(created.status).toBe(200)
  const send = (await created.json()) as { id: string; object: string; accessCount: number }
  expect(send.object).toBe('send')
  expect(send.accessCount).toBe(0)

  const list = (await (await api('/api/sends')).json()) as { data: { id: string }[] }
  expect(list.data).toHaveLength(1)

  const sync = (await (await api('/api/sync')).json()) as { sends: { id: string }[] }
  expect(sync.sends).toHaveLength(1)
  expect(sync.sends[0]?.id).toBe(send.id)
})

it('updates a send and removes its password separately', async () => {
  const created = await api('/api/sends', {
    method: 'POST',
    body: JSON.stringify({ ...aSend, password: 'hashed-access-password' }),
  })
  const { id } = (await created.json()) as { id: string }

  const updated = await api(`/api/sends/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ ...aSend, name: '2.renamed', password: 'hashed-access-password' }),
  })
  expect(((await updated.json()) as { name: string }).name).toBe('2.renamed')

  const cleared = await api(`/api/sends/${id}/remove-password`, { method: 'PUT' })
  expect(((await cleared.json()) as { password: string | null }).password).toBeNull()
})

it('keeps a text send out of the file field and vice versa', async () => {
  const text = await api('/api/sends', { method: 'POST', body: JSON.stringify(aSend) })
  const t = (await text.json()) as { text: unknown; file: unknown }
  expect(t.text).not.toBeNull()
  expect(t.file).toBeNull()

  const file = await api('/api/sends', {
    method: 'POST',
    body: JSON.stringify({ ...aSend, type: 1, text: null, file: { fileName: '2.f', size: 10 } }),
  })
  const f = (await file.json()) as { text: unknown; file: unknown }
  expect(f.file).not.toBeNull()
  expect(f.text).toBeNull()
})

it('will not touch another user’s send', async () => {
  const created = await api('/api/sends', { method: 'POST', body: JSON.stringify(aSend) })
  const { id } = (await created.json()) as { id: string }

  const bob = { email: 'bob@example.com', masterPasswordHash: 'Ym9i', key: '2.bobkey' }
  await register(bob)
  const bobAuth = await authHeaders(bob)

  const res = await SELF.fetch(`${ORIGIN}/api/sends/${id}`, { headers: bobAuth })
  expect(res.status).toBe(404)
})
