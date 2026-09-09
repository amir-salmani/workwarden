import { SELF } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { authHeaders, ORIGIN, register, resetDatabase } from './support.ts'

type Sync = {
  profile: { email: string }
  folders: { id: string; name: string; object: string }[]
  ciphers: {
    id: string
    name: string
    folderId: string | null
    deletedDate: string | null
    object: string
  }[]
  collections: unknown[]
  object: string
}

let auth: Record<string, string>

beforeEach(async () => {
  await resetDatabase()
  await register()
  auth = await authHeaders()
})

function api(path: string, init: RequestInit = {}) {
  return SELF.fetch(`${ORIGIN}${path}`, {
    ...init,
    headers: { ...auth, 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

async function getSync(): Promise<Sync> {
  const res = await api('/api/sync')
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('application/json')
  return (await res.json()) as Sync
}

it('syncs an empty vault', async () => {
  const body = await getSync()
  expect(body.object).toBe('sync')
  expect(body.profile.email).toBe('alice@example.com')
  expect(body.ciphers).toEqual([])
  expect(body.folders).toEqual([])
  expect(body.collections).toEqual([])
})

it('round-trips a cipher through sync', async () => {
  const created = await api('/api/ciphers', {
    method: 'POST',
    body: JSON.stringify({
      type: 1,
      name: '2.encrypted-name',
      notes: null,
      login: { username: '2.user', password: '2.pass' },
      favorite: true,
    }),
  })
  expect(created.status).toBe(200)
  const cipher = (await created.json()) as { id: string; object: string; favorite: boolean }
  expect(cipher.object).toBe('cipherDetails')
  expect(cipher.favorite).toBe(true)

  const body = await getSync()
  expect(body.ciphers).toHaveLength(1)
  expect(body.ciphers[0]).toMatchObject({
    id: cipher.id,
    name: '2.encrypted-name',
    type: 1,
    object: 'cipherDetails',
  })
})

it('keeps the client blob and the server fields apart', async () => {
  const created = await api('/api/ciphers', {
    method: 'POST',
    body: JSON.stringify({ type: 2, name: '2.note', notes: '2.body' }),
  })
  const { id } = (await created.json()) as { id: string }

  const updated = await api(`/api/ciphers/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ type: 2, name: '2.renamed', notes: '2.body', favorite: true }),
  })
  const after = (await updated.json()) as { name: string; favorite: boolean; id: string }
  expect(after.id).toBe(id)
  expect(after.name).toBe('2.renamed')
  expect(after.favorite).toBe(true)
})

it('files a cipher in a folder and unfiles it when the folder goes', async () => {
  const folderRes = await api('/api/folders', {
    method: 'POST',
    body: JSON.stringify({ name: '2.folder' }),
  })
  const folder = (await folderRes.json()) as { id: string; object: string }
  expect(folder.object).toBe('folder')

  await api('/api/ciphers', {
    method: 'POST',
    body: JSON.stringify({ type: 1, name: '2.in-folder', folderId: folder.id }),
  })

  let body = await getSync()
  expect(body.ciphers[0]?.folderId).toBe(folder.id)

  expect((await api(`/api/folders/${folder.id}`, { method: 'DELETE' })).status).toBe(200)

  body = await getSync()
  expect(body.folders).toEqual([])
  expect(body.ciphers).toHaveLength(1)
  expect(body.ciphers[0]?.folderId).toBeNull()
})

it('moves a cipher to the trash and back', async () => {
  const created = await api('/api/ciphers', {
    method: 'POST',
    body: JSON.stringify({ type: 1, name: '2.doomed' }),
  })
  const { id } = (await created.json()) as { id: string }

  await api(`/api/ciphers/${id}/delete`, { method: 'PUT' })
  let body = await getSync()
  expect(body.ciphers[0]).toMatchObject({ id })
  expect(body.ciphers[0]?.deletedDate).toEqual(expect.stringContaining('T'))

  await api(`/api/ciphers/${id}/restore`, { method: 'PUT' })
  body = await getSync()
  expect(body.ciphers[0]?.deletedDate).toBeNull()

  await api(`/api/ciphers/${id}`, { method: 'DELETE' })
  body = await getSync()
  expect(body.ciphers).toEqual([])
})

it('will not touch another user’s cipher', async () => {
  const created = await api('/api/ciphers', {
    method: 'POST',
    body: JSON.stringify({ type: 1, name: '2.mine' }),
  })
  const { id } = (await created.json()) as { id: string }

  const bob = { email: 'bob@example.com', masterPasswordHash: 'Ym9i', key: '2.bobkey' }
  await register(bob)
  const bobAuth = await authHeaders(bob)

  const res = await SELF.fetch(`${ORIGIN}/api/ciphers/${id}`, { headers: bobAuth })
  expect(res.status).toBe(404)
})
