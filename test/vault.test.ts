import { env, SELF } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { connect } from '../src/db.ts'
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

it('bulk-imports ciphers and folders, wiring up the relationships', async () => {
  const res = await api('/api/ciphers/import', {
    method: 'POST',
    body: JSON.stringify({
      folders: [{ name: '2.imported-folder' }],
      ciphers: [
        { type: 1, name: '2.in-folder', login: { username: '2.u' } },
        { type: 2, name: '2.loose', notes: '2.n' },
      ],
      folderRelationships: [{ key: 0, value: 0 }],
    }),
  })
  expect(res.status).toBe(200)

  const body = await getSync()
  expect(body.folders).toHaveLength(1)
  expect(body.ciphers).toHaveLength(2)

  const filed = body.ciphers.find((c) => c.name === '2.in-folder')
  const loose = body.ciphers.find((c) => c.name === '2.loose')
  expect(filed?.folderId).toBe(body.folders[0]?.id)
  expect(loose?.folderId).toBeNull()
})

it('does not mistake /import for a cipher id', async () => {
  const res = await api('/api/ciphers/import', { method: 'POST', body: JSON.stringify({}) })
  expect(res.status).toBe(200)
})

it("keeps a cipher's own encryption key instead of overwriting it", async () => {
  const created = await api('/api/ciphers', {
    method: 'POST',
    body: JSON.stringify({
      type: 1,
      name: '2.item-with-its-own-key',
      key: '2.per-cipher-key',
      login: { username: '2.u' },
    }),
  })
  expect(created.status).toBe(200)
  expect((await created.json()) as { key: string }).toMatchObject({ key: '2.per-cipher-key' })

  const body = await getSync()
  expect((body.ciphers[0] as unknown as { key: string }).key).toBe('2.per-cipher-key')
})

it('still reports a null key for ciphers that have none', async () => {
  await api('/api/ciphers', {
    method: 'POST',
    body: JSON.stringify({ type: 1, name: '2.plain', login: { username: '2.u' } }),
  })
  const body = await getSync()
  expect((body.ciphers[0] as unknown as { key: string | null }).key).toBeNull()
})

it('lists an attachment on its cipher and streams the blob', async () => {
  const sql = connect(env)
  const created = await api('/api/ciphers', {
    method: 'POST',
    body: JSON.stringify({ type: 1, name: '2.has-attachment', login: { username: '2.u' } }),
  })
  const { id } = (await created.json()) as { id: string }

  await sql`
    insert into attachments (id, cipher_id, file_name, file_size, akey)
    values ('att1', ${id}, '2.secret.pdf', 2048, '2.attachment-key')`
  await env.ATTACHMENTS.put(`${id}/att1`, 'encrypted-bytes')

  const body = await getSync()
  const cipher = body.ciphers.find((c) => c.id === id) as unknown as {
    attachments: { id: string; url: string; fileName: string; sizeName: string }[]
  }
  expect(cipher.attachments).toHaveLength(1)
  expect(cipher.attachments[0]).toMatchObject({
    id: 'att1',
    fileName: '2.secret.pdf',
    sizeName: '2.00 KB',
  })
  expect(cipher.attachments[0]?.url).toBe(`${ORIGIN}/attachments/${id}/att1`)

  const blob = await SELF.fetch(`${ORIGIN}/attachments/${id}/att1`, { headers: auth })
  expect(blob.status).toBe(200)
  expect(await blob.text()).toBe('encrypted-bytes')
})

it('reserves an attachment, accepts the bytes, then deletes it', async () => {
  const created = await api('/api/ciphers', {
    method: 'POST',
    body: JSON.stringify({ type: 1, name: '2.with-upload', login: { username: '2.u' } }),
  })
  const { id } = (await created.json()) as { id: string }

  const reserve = await api(`/api/ciphers/${id}/attachment/v2`, {
    method: 'POST',
    body: JSON.stringify({ fileName: '2.report.pdf', key: '2.att-key', fileSize: 11 }),
  })
  expect(reserve.status).toBe(200)
  const { attachmentId, url, fileUploadType } = (await reserve.json()) as {
    attachmentId: string
    url: string
    fileUploadType: number
  }
  expect(fileUploadType).toBe(0)
  expect(url).toContain(`/api/ciphers/${id}/attachment/${attachmentId}`)

  const body = new FormData()
  body.append('data', new File(['ciphertext!'], 'blob'))
  const upload = await SELF.fetch(url, { method: 'POST', headers: auth, body })
  expect(upload.status).toBe(200)

  const stored = await env.ATTACHMENTS.get(`${id}/${attachmentId}`)
  expect(await stored?.text()).toBe('ciphertext!')

  const synced = await getSync()
  const cipher = synced.ciphers.find((c) => c.id === id) as unknown as {
    attachments: { id: string; size: string }[]
  }
  expect(cipher.attachments).toHaveLength(1)
  // The size recorded is what actually arrived, not what the client promised.
  expect(cipher.attachments[0]?.size).toBe('11')

  const removed = await api(`/api/ciphers/${id}/attachment/${attachmentId}`, { method: 'DELETE' })
  expect(removed.status).toBe(200)
  expect(await env.ATTACHMENTS.get(`${id}/${attachmentId}`)).toBeNull()

  const after = await getSync()
  const gone = after.ciphers.find((c) => c.id === id) as unknown as { attachments: null }
  expect(gone.attachments).toBeNull()
})

it('will not serve an attachment on someone else’s cipher', async () => {
  const bob = { email: 'bob@example.com', masterPasswordHash: 'Ym9i', key: '2.bobkey' }
  await register(bob)
  const bobAuth = await authHeaders(bob)

  const created = await api('/api/ciphers', {
    method: 'POST',
    body: JSON.stringify({ type: 1, name: '2.mine', login: { username: '2.u' } }),
  })
  const { id } = (await created.json()) as { id: string }

  const sql = connect(env)
  await sql`
    insert into attachments (id, cipher_id, file_name, file_size)
    values ('att9', ${id}, '2.mine.pdf', 4)`
  await env.ATTACHMENTS.put(`${id}/att9`, 'mine')

  const res = await SELF.fetch(`${ORIGIN}/attachments/${id}/att9`, { headers: bobAuth })
  expect(res.status).toBe(404)
})

it('will not let a stranger attach a file to someone else’s cipher', async () => {
  const created = await api('/api/ciphers', {
    method: 'POST',
    body: JSON.stringify({ type: 1, name: '2.mine', login: { username: '2.u' } }),
  })
  const { id } = (await created.json()) as { id: string }

  const bob = { email: 'bob@example.com', masterPasswordHash: 'Ym9i', key: '2.bobkey' }
  await register(bob)
  const bobAuth = await authHeaders(bob)

  const res = await SELF.fetch(`${ORIGIN}/api/ciphers/${id}/attachment/v2`, {
    method: 'POST',
    headers: { ...bobAuth, 'content-type': 'application/json' },
    body: JSON.stringify({ fileName: '2.x', key: '2.k', fileSize: 1 }),
  })
  expect(res.status).toBe(404)
})

it('tells the client it may delete and restore its own items', async () => {
  // Clients default both to false when this object is missing, and then refuse
  // Delete and Restore on every item despite the server allowing them.
  const created = await api('/api/ciphers', {
    method: 'POST',
    body: JSON.stringify({ type: 1, name: '2.deletable', login: { username: '2.u' } }),
  })
  const cipher = (await created.json()) as { permissions: { delete: boolean; restore: boolean } }
  expect(cipher.permissions).toEqual({ delete: true, restore: true })

  const synced = await getSync()
  const fromSync = synced.ciphers[0] as unknown as { permissions: unknown }
  expect(fromSync.permissions).toEqual({ delete: true, restore: true })
})
