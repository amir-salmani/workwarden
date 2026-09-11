import { SELF } from 'cloudflare:test'
import { beforeEach, expect, it } from 'vitest'
import { MessageType, RECORD_SEPARATOR, unframe } from '../src/signalr/protocol.ts'
import { authHeaders, ORIGIN, register, resetDatabase } from './support.ts'

const RS = String.fromCharCode(RECORD_SEPARATOR)
let auth: Record<string, string>
let token: string

beforeEach(async () => {
  await resetDatabase()
  await register()
  auth = await authHeaders()
  token = auth.Authorization?.replace('Bearer ', '') ?? ''
})

it('refuses to negotiate without a valid token', async () => {
  const res = await SELF.fetch(`${ORIGIN}/notifications/hub/negotiate`, { method: 'POST' })
  expect(res.status).toBe(401)
})

it('negotiates for an authenticated client', async () => {
  const res = await SELF.fetch(`${ORIGIN}/notifications/hub/negotiate`, {
    method: 'POST',
    headers: auth,
  })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { availableTransports: { transport: string }[] }
  expect(body.availableTransports[0]?.transport).toBe('WebSockets')
})

it('refuses a socket whose token is not valid', async () => {
  const res = await SELF.fetch(`${ORIGIN}/notifications/hub?access_token=nonsense`, {
    headers: { upgrade: 'websocket' },
  })
  expect(res.status).toBe(401)
})

it('accepts the token from the query string, because browsers cannot set headers', async () => {
  const res = await SELF.fetch(`${ORIGIN}/notifications/hub?access_token=${token}`, {
    headers: { upgrade: 'websocket' },
  })
  expect(res.status).toBe(101)
  res.webSocket?.accept()
  res.webSocket?.close()
})

it('completes the handshake and answers a ping', async () => {
  const res = await SELF.fetch(`${ORIGIN}/notifications/hub?access_token=${token}`, {
    headers: { upgrade: 'websocket' },
  })
  const ws = res.webSocket
  if (!ws) throw new Error('expected a websocket')
  ws.accept()

  // Without this, binary frames arrive as Blob and every assertion below reads
  // the wrong type.
  ws.binaryType = 'arraybuffer'
  const received: (string | ArrayBuffer)[] = []
  ws.addEventListener('message', (e) => received.push(e.data as string | ArrayBuffer))

  ws.send(`{"protocol":"messagepack","version":1}${RS}`)
  await new Promise((r) => setTimeout(r, 50))
  expect(received[0]).toBe(`{}${RS}`)

  // A ping frame: body length 2, then 0x91 (array of one) and the Ping type.
  ws.send(new Uint8Array([2, 0x91, MessageType.Ping]))
  await new Promise((r) => setTimeout(r, 50))

  const pong = received[1]
  expect(pong).toBeInstanceOf(ArrayBuffer)
  const { messages } = unframe(new Uint8Array(pong as ArrayBuffer))
  expect(messages).toEqual([[MessageType.Ping]])
  ws.close()
})

it('rejects a protocol it cannot speak rather than pretending', async () => {
  const res = await SELF.fetch(`${ORIGIN}/notifications/hub?access_token=${token}`, {
    headers: { upgrade: 'websocket' },
  })
  const ws = res.webSocket
  if (!ws) throw new Error('expected a websocket')
  ws.accept()

  const received: string[] = []
  ws.addEventListener('message', (e) => received.push(String(e.data)))
  ws.send(`{"protocol":"json","version":1}${RS}`)
  await new Promise((r) => setTimeout(r, 50))

  expect(received[0]).toContain('unsupported protocol')
})

it('delivers a cipher change to a connected client', async () => {
  const res = await SELF.fetch(`${ORIGIN}/notifications/hub?access_token=${token}`, {
    headers: { upgrade: 'websocket' },
  })
  const ws = res.webSocket
  if (!ws) throw new Error('expected a websocket')
  ws.accept()

  ws.binaryType = 'arraybuffer'
  const frames: ArrayBuffer[] = []
  ws.addEventListener('message', (e) => {
    if (e.data instanceof ArrayBuffer) frames.push(e.data)
  })
  ws.send(`{"protocol":"messagepack","version":1}${RS}`)
  await new Promise((r) => setTimeout(r, 50))

  await SELF.fetch(`${ORIGIN}/api/ciphers`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 1, name: '2.pushed', login: { username: '2.u' } }),
  })
  await new Promise((r) => setTimeout(r, 150))

  expect(frames.length).toBeGreaterThan(0)
  const { messages } = unframe(new Uint8Array(frames[0] as ArrayBuffer))
  const [invocation] = messages as [unknown[]]
  expect(invocation[0]).toBe(MessageType.Invocation)
  expect(invocation[3]).toBe('ReceiveMessage')
  const [arg] = invocation[4] as [{ Type: number; Payload: { Id: string } }]
  expect(arg.Type).toBe(1) // SyncCipherCreate
  expect(typeof arg.Payload.Id).toBe('string')
  ws.close()
})
