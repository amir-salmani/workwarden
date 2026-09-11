import { decode, encode, type Packable } from './messagepack.ts'

/**
 * SignalR's hub protocol, the parts a notification server needs.
 *
 * Binary frames are length-prefixed with a 7-bit varint; the handshake before
 * them is JSON terminated by a record separator, not MessagePack. Mixing those
 * two framings up is the classic way to produce a connection that opens and
 * then silently never delivers anything.
 */
export const RECORD_SEPARATOR = 0x1e

export const MessageType = {
  Invocation: 1,
  StreamItem: 2,
  Completion: 3,
  StreamInvocation: 4,
  CancelInvocation: 5,
  Ping: 6,
  Close: 7,
} as const

/** Bitwarden's notification types, as clients expect them on the wire. */
export const Notification = {
  SyncCipherUpdate: 0,
  SyncCipherCreate: 1,
  SyncLoginDelete: 2,
  SyncFolderDelete: 3,
  SyncCiphers: 4,
  SyncVault: 5,
  SyncOrgKeys: 6,
  SyncFolderCreate: 7,
  SyncFolderUpdate: 8,
  SyncCipherDelete: 9,
  SyncSettings: 10,
  LogOut: 11,
  SyncSendCreate: 12,
  SyncSendUpdate: 13,
  SyncSendDelete: 14,
} as const

/** The handshake reply is JSON followed by a record separator, not a frame. */
export function encodeHandshakeResponse(error?: string): string {
  return JSON.stringify(error ? { error } : {}) + String.fromCharCode(RECORD_SEPARATOR)
}

export function parseHandshake(data: string): { protocol?: string; version?: number } | null {
  const end = data.indexOf(String.fromCharCode(RECORD_SEPARATOR))
  if (end === -1) return null
  try {
    return JSON.parse(data.slice(0, end))
  } catch {
    return null
  }
}

export function frame(message: Packable): Uint8Array {
  const body = encode(message)
  const prefix = varint(body.byteLength)
  const out = new Uint8Array(prefix.byteLength + body.byteLength)
  out.set(prefix, 0)
  out.set(body, prefix.byteLength)
  return out
}

/** A buffer may carry several frames, or part of one; return what is complete. */
export function unframe(buffer: Uint8Array): { messages: Packable[]; rest: Uint8Array } {
  const messages: Packable[] = []
  let at = 0
  while (at < buffer.byteLength) {
    const header = readVarint(buffer, at)
    if (!header) break
    const [length, headerSize] = header
    const start = at + headerSize
    if (start + length > buffer.byteLength) break
    messages.push(decode(buffer.subarray(start, start + length)))
    at = start + length
  }
  return { messages, rest: buffer.subarray(at) }
}

export const ping = () => frame([MessageType.Ping])

export function notify(type: number, payload: Packable, contextId: string | null = null) {
  return frame([
    MessageType.Invocation,
    {},
    null,
    'ReceiveMessage',
    [{ ContextId: contextId, Type: type, Payload: payload }],
  ])
}

function varint(n: number): Uint8Array {
  const bytes: number[] = []
  let value = n
  do {
    let byte = value & 0x7f
    value >>>= 7
    if (value > 0) byte |= 0x80
    bytes.push(byte)
  } while (value > 0)
  return new Uint8Array(bytes)
}

function readVarint(b: Uint8Array, at: number): [number, number] | null {
  let value = 0
  let shift = 0
  for (let i = 0; i < 5; i++) {
    const byte = b[at + i]
    if (byte === undefined) return null
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return [value >>> 0, i + 1]
    shift += 7
  }
  throw new RangeError('signalr: length prefix is too long')
}
