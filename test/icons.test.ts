import { env, SELF } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'

beforeEach(async () => {
  for (const key of ['icons/example.com', 'icons/nope.example']) {
    await env.ATTACHMENTS.delete(key)
  }
})

const ORIGIN = 'https://vault.example.com'

it('refuses hostnames that are not plainly public', async () => {
  for (const bad of ['localhost', '127.0.0.1', 'router.local', 'thing.internal', 'a..b.com']) {
    const res = await SELF.fetch(`${ORIGIN}/icons/${bad}/icon.png`)
    expect(res.status, bad).toBe(404)
  }
})

it('remembers that a domain has no icon instead of refetching it', async () => {
  // A zero-length object is the negative result the route writes.
  await env.ATTACHMENTS.put('icons/nope.example', new Uint8Array(0))
  const res = await SELF.fetch(`${ORIGIN}/icons/nope.example/icon.png`)
  expect(res.status).toBe(404)
})

it('serves a cached icon without going to the network', async () => {
  await env.ATTACHMENTS.put('icons/example.com', 'PNGDATA', {
    httpMetadata: { contentType: 'image/png' },
  })
  const res = await SELF.fetch(`${ORIGIN}/icons/example.com/icon.png`)
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toBe('image/png')
  expect(res.headers.get('cache-control')).toContain('max-age=')
  expect(await res.text()).toBe('PNGDATA')
})

it('does not require a session, because icons load before unlock', async () => {
  await env.ATTACHMENTS.put('icons/example.com', 'PNGDATA', {
    httpMetadata: { contentType: 'image/png' },
  })
  const res = await SELF.fetch(`${ORIGIN}/icons/example.com/icon.png`)
  expect(res.status).toBe(200)
})
