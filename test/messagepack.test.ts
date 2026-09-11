import { expect, it } from 'vitest'
import { decode, encode, type Packable } from '../src/signalr/messagepack.ts'

const roundTrip = (value: Packable) => decode(encode(value))

it('round-trips the scalars SignalR uses', () => {
  for (const value of [null, true, false, 0, 1, 127, 128, 255, 256, 65535, 65536, 4294967296]) {
    expect(roundTrip(value), String(value)).toEqual(value)
  }
})

it('round-trips negative numbers across each encoding boundary', () => {
  for (const value of [-1, -32, -33, -128, -129, -32768, -32769, -2147483648]) {
    expect(roundTrip(value), String(value)).toEqual(value)
  }
})

it('round-trips floats', () => {
  expect(roundTrip(1.5)).toBe(1.5)
  expect(roundTrip(-0.25)).toBe(-0.25)
})

it('round-trips strings across the length boundaries', () => {
  for (const len of [0, 31, 32, 255, 256, 70000]) {
    const s = 'a'.repeat(len)
    expect((roundTrip(s) as string).length, `len ${len}`).toBe(len)
  }
})

it('round-trips non-ASCII, which fixstr sizes in bytes not characters', () => {
  // 11 characters, 22 bytes: a length written in characters would corrupt this.
  const s = 'سلام دنیا ا'
  expect(roundTrip(s)).toBe(s)
})

it('round-trips arrays and maps across the length boundaries', () => {
  for (const len of [0, 15, 16, 100]) {
    const arr = Array.from({ length: len }, (_, i) => i)
    expect(roundTrip(arr), `array ${len}`).toEqual(arr)

    const map: Record<string, number> = {}
    for (let i = 0; i < len; i++) map[`k${i}`] = i
    expect(roundTrip(map), `map ${len}`).toEqual(map)
  }
})

it('round-trips binary', () => {
  const bytes = new Uint8Array([0, 1, 254, 255])
  expect(roundTrip(bytes)).toEqual(bytes)
})

it('round-trips a whole SignalR invocation frame', () => {
  const frame: Packable = [
    1,
    {},
    null,
    'ReceiveMessage',
    [{ ContextId: 'ctx', Type: 1, Payload: { Id: 'abc', RevisionDate: '2026-01-01T00:00:00Z' } }],
  ]
  expect(roundTrip(frame)).toEqual(frame)
})

it('refuses to encode something a client could misread', () => {
  expect(() => encode(undefined as never)).not.toThrow() // undefined encodes as nil
  expect(() => encode(Symbol('x') as never)).toThrow(/cannot encode/)
})

it('refuses to decode a truncated frame rather than inventing a value', () => {
  expect(() => decode(new Uint8Array([]))).toThrow(/truncated/)
})
