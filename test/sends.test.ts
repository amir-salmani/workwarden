import { SELF } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { authHeaders, ORIGIN, register, resetDatabase } from './support.ts'

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

const accessIdOf = (id: string) => id.replaceAll('-', '')

it('serves a send to someone with only the link, and counts the access', async () => {
  const created = await api('/api/sends', { method: 'POST', body: JSON.stringify(aSend) })
  const { id } = (await created.json()) as { id: string }

  // No auth header: a recipient has a link, not an account.
  const res = await SELF.fetch(`${ORIGIN}/api/sends/access/${accessIdOf(id)}`, { method: 'POST' })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { key: string; text: unknown; password?: string }
  expect(body.key).toBe('2.send-key')
  expect(body.text).not.toBeNull()
  expect(body.password).toBeUndefined()

  const mine = (await (await api(`/api/sends/${id}`)).json()) as { accessCount: number }
  expect(mine.accessCount).toBe(1)
})

it('refuses a password-protected send without the password, without burning an access', async () => {
  const created = await api('/api/sends', {
    method: 'POST',
    body: JSON.stringify({ ...aSend, password: 'hashed-access-password' }),
  })
  const { id } = (await created.json()) as { id: string }
  const url = `${ORIGIN}/api/sends/access/${accessIdOf(id)}`

  const refused = await SELF.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'wrong' }),
  })
  expect(refused.status).toBe(401)
  expect(
    ((await (await api(`/api/sends/${id}`)).json()) as { accessCount: number }).accessCount,
  ).toBe(0)

  const allowed = await SELF.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'hashed-access-password' }),
  })
  expect(allowed.status).toBe(200)
})

it('stops serving a send once its access limit is reached', async () => {
  const created = await api('/api/sends', {
    method: 'POST',
    body: JSON.stringify({ ...aSend, maxAccessCount: 1 }),
  })
  const { id } = (await created.json()) as { id: string }
  const url = `${ORIGIN}/api/sends/access/${accessIdOf(id)}`

  expect((await SELF.fetch(url, { method: 'POST' })).status).toBe(200)
  expect((await SELF.fetch(url, { method: 'POST' })).status).toBe(404)
})

it('does not distinguish a disabled send from one that never existed', async () => {
  const created = await api('/api/sends', {
    method: 'POST',
    body: JSON.stringify({ ...aSend, disabled: true }),
  })
  const { id } = (await created.json()) as { id: string }

  const disabled = await SELF.fetch(`${ORIGIN}/api/sends/access/${accessIdOf(id)}`, {
    method: 'POST',
  })
  const missing = await SELF.fetch(`${ORIGIN}/api/sends/access/${'0'.repeat(32)}`, {
    method: 'POST',
  })
  expect(disabled.status).toBe(missing.status)
  expect(await disabled.text()).toBe(await missing.text())
})

const aFileSend = {
  ...aSend,
  type: 1,
  text: null,
  file: { fileName: '2.secret.txt' },
}

const upload = (url: string, bytes: Uint8Array) => {
  const form = new FormData()
  form.append('data', new File([bytes], 'ignored'))
  return SELF.fetch(url, { method: 'POST', body: form, headers: auth })
}

async function reserve(bytes: Uint8Array) {
  const res = await api('/api/sends/file/v2', {
    method: 'POST',
    body: JSON.stringify({ ...aFileSend, fileLength: bytes.length }),
  })
  expect(res.status).toBe(200)
  return (await res.json()) as {
    url: string
    fileUploadType: number
    sendResponse: { id: string; file: { id: string; size: number } }
  }
}

it('reserves a file send, takes the bytes, and hands them back over a link', async () => {
  const bytes = crypto.getRandomValues(new Uint8Array(64))
  const { url, fileUploadType, sendResponse } = await reserve(bytes)
  expect(fileUploadType).toBe(0)
  expect((await upload(url, bytes)).status).toBe(200)

  const mine = (await (await api(`/api/sends/${sendResponse.id}`)).json()) as {
    file: { size: number; sizeName: string }
  }
  expect(mine.file.size).toBe(64)
  expect(mine.file.sizeName).toBe('64 Bytes')

  // A recipient has a link and nothing else: no session on any of these calls.
  const accessId = accessIdOf(sendResponse.id)
  const meta = (await (
    await SELF.fetch(`${ORIGIN}/api/sends/access/${accessId}`, { method: 'POST' })
  ).json()) as { file: { id: string } }

  const link = await SELF.fetch(`${ORIGIN}/api/sends/access/${accessId}/file/${meta.file.id}`, {
    method: 'POST',
  })
  const { url: downloadUrl } = (await link.json()) as { url: string }

  const got = await SELF.fetch(downloadUrl)
  expect(got.status).toBe(200)
  expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes)
})

it('will not serve a send file without the download token', async () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const { url, sendResponse } = await reserve(bytes)
  await upload(url, bytes)

  const fileId = sendResponse.file.id
  const naked = `${ORIGIN}/api/sends/access/file/${sendResponse.id}/${fileId}`
  expect((await SELF.fetch(naked)).status).toBe(404)
  expect((await SELF.fetch(`${naked}?t=not-a-token`)).status).toBe(404)
})

it('counts a file send once, not twice', async () => {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  const { url, sendResponse } = await reserve(bytes)
  await upload(url, bytes)
  const accessId = accessIdOf(sendResponse.id)

  await SELF.fetch(`${ORIGIN}/api/sends/access/${accessId}`, { method: 'POST' })
  await SELF.fetch(`${ORIGIN}/api/sends/access/${accessId}/file/${sendResponse.file.id}`, {
    method: 'POST',
  })

  const mine = (await (await api(`/api/sends/${sendResponse.id}`)).json()) as {
    accessCount: number
  }
  expect(mine.accessCount).toBe(1)
})

it('takes one upload per reservation, and no more', async () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const { url } = await reserve(bytes)
  expect((await upload(url, bytes)).status).toBe(200)
  expect((await upload(url, bytes)).status).toBe(404)
})

it('drops the send when the file is bigger than it reserved', async () => {
  const { url, sendResponse } = await reserve(new Uint8Array(8))
  expect((await upload(url, crypto.getRandomValues(new Uint8Array(64)))).status).toBe(400)
  expect((await api(`/api/sends/${sendResponse.id}`)).status).toBe(404)
})

it('turns away the one-request upload older clients used', async () => {
  expect((await api('/api/sends/file', { method: 'POST', body: '{}' })).status).toBe(400)
})

it('stops someone grinding a password-protected send', async () => {
  const created = await api('/api/sends', {
    method: 'POST',
    body: JSON.stringify({ ...aSend, password: 'hashed-access-password' }),
  })
  const { id } = (await created.json()) as { id: string }
  const url = `${ORIGIN}/api/sends/access/${accessIdOf(id)}`
  const guess = (password: string) =>
    SELF.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    })

  for (let i = 0; i < 10; i++) expect((await guess(`wrong-${i}`)).status).toBe(401)

  // Blocked now -- and the right password does not unblock it either.
  expect((await guess('wrong-again')).status).toBe(429)
  expect((await guess('hashed-access-password')).status).toBe(429)

  // A failed attempt still must not burn an access.
  const mine = (await (await api(`/api/sends/${id}`)).json()) as { accessCount: number }
  expect(mine.accessCount).toBe(0)
})
