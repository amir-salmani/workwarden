import { expect, it } from 'vitest'
import { decode } from '../src/signalr/messagepack.ts'
import {
  encodeHandshakeResponse,
  frame,
  MessageType,
  notify,
  parseHandshake,
  ping,
  RECORD_SEPARATOR,
  unframe,
} from '../src/signalr/protocol.ts'

const RS = String.fromCharCode(RECORD_SEPARATOR)

it('parses the handshake a Bitwarden client sends', () => {
  const parsed = parseHandshake(`{"protocol":"messagepack","version":1}${RS}`)
  expect(parsed).toEqual({ protocol: 'messagepack', version: 1 })
})

it('returns null for a handshake that has not fully arrived', () => {
  expect(parseHandshake('{"protocol":"messagepack"')).toBeNull()
})

it('terminates the handshake response with a record separator', () => {
  expect(encodeHandshakeResponse()).toBe(`{}${RS}`)
  expect(encodeHandshakeResponse('nope')).toBe(`{"error":"nope"}${RS}`)
})

it('round-trips a frame through its length prefix', () => {
  const { messages, rest } = unframe(frame([MessageType.Ping]))
  expect(messages).toEqual([[MessageType.Ping]])
  expect(rest.byteLength).toBe(0)
})

it('reads several frames out of one buffer', () => {
  const a = ping()
  const b = notify(1, { Id: 'x' })
  const buffer = new Uint8Array(a.byteLength + b.byteLength)
  buffer.set(a, 0)
  buffer.set(b, a.byteLength)

  const { messages, rest } = unframe(buffer)
  expect(messages).toHaveLength(2)
  expect(rest.byteLength).toBe(0)
})

it('keeps a partial frame back instead of decoding rubbish', () => {
  const full = notify(1, { Id: 'x' })
  const { messages, rest } = unframe(full.subarray(0, full.byteLength - 3))
  expect(messages).toEqual([])
  expect(rest.byteLength).toBeGreaterThan(0)
})

it('frames a payload larger than a single-byte length prefix', () => {
  const big = { Id: 'x'.repeat(500) }
  const { messages } = unframe(notify(1, big))
  const [invocation] = messages as [unknown[]]
  expect(invocation[3]).toBe('ReceiveMessage')
})

it('builds the invocation shape a client listens for', () => {
  const { messages } = unframe(notify(9, { Id: 'cipher-1' }, 'ctx-1'))
  expect(decode(frame(messages[0] ?? null).subarray(1))).toEqual([
    MessageType.Invocation,
    {},
    null,
    'ReceiveMessage',
    [{ ContextId: 'ctx-1', Type: 9, Payload: { Id: 'cipher-1' } }],
  ])
})
