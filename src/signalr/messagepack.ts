/**
 * The slice of MessagePack that SignalR needs.
 *
 * Bitwarden clients negotiate the `messagepack` protocol, so JSON is not an
 * option -- the handshake fails if the server cannot speak it. Only the types
 * SignalR frames actually use are implemented; anything else throws rather than
 * silently encoding something a client will misread.
 */

export type Packable =
  | null
  | boolean
  | number
  | string
  | Uint8Array
  | Packable[]
  | { [key: string]: Packable }

const utf8 = new TextEncoder()
const utf8Decoder = new TextDecoder()

class Writer {
  private parts: Uint8Array[] = []

  bytes(b: Uint8Array) {
    this.parts.push(b)
  }

  byte(...values: number[]) {
    this.parts.push(new Uint8Array(values))
  }

  big(tag: number, value: number, size: 2 | 4 | 8) {
    const buf = new Uint8Array(1 + size)
    buf[0] = tag
    const view = new DataView(buf.buffer)
    if (size === 2) view.setUint16(1, value)
    else if (size === 4) view.setUint32(1, value)
    else view.setBigUint64(1, BigInt(value))
    this.parts.push(buf)
  }

  finish(): Uint8Array {
    const total = this.parts.reduce((n, p) => n + p.byteLength, 0)
    const out = new Uint8Array(total)
    let at = 0
    for (const p of this.parts) {
      out.set(p, at)
      at += p.byteLength
    }
    return out
  }
}

export function encode(value: Packable): Uint8Array {
  const w = new Writer()
  write(w, value)
  return w.finish()
}

function write(w: Writer, value: Packable): void {
  if (value === null || value === undefined) w.byte(0xc0)
  else if (typeof value === 'boolean') w.byte(value ? 0xc3 : 0xc2)
  else if (typeof value === 'number') writeNumber(w, value)
  else if (typeof value === 'string') writeString(w, value)
  else if (value instanceof Uint8Array) writeBinary(w, value)
  else if (Array.isArray(value)) writeArray(w, value)
  else if (typeof value === 'object') writeMap(w, value)
  else throw new TypeError(`messagepack: cannot encode ${typeof value}`)
}

function writeNumber(w: Writer, n: number) {
  if (!Number.isInteger(n)) {
    const buf = new Uint8Array(9)
    buf[0] = 0xcb
    new DataView(buf.buffer).setFloat64(1, n)
    return w.bytes(buf)
  }
  if (n >= 0) {
    if (n < 0x80) return w.byte(n)
    if (n < 0x100) return w.byte(0xcc, n)
    if (n < 0x10000) return w.big(0xcd, n, 2)
    if (n < 0x100000000) return w.big(0xce, n, 4)
    return w.big(0xcf, n, 8)
  }
  if (n >= -32) return w.byte(0x100 + n)
  if (n >= -0x80) return w.byte(0xd0, 0x100 + n)
  const buf = new Uint8Array(5)
  buf[0] = 0xd2
  new DataView(buf.buffer).setInt32(1, n)
  return w.bytes(buf)
}

function writeString(w: Writer, s: string) {
  const bytes = utf8.encode(s)
  const n = bytes.byteLength
  if (n < 32) w.byte(0xa0 | n)
  else if (n < 0x100) w.byte(0xd9, n)
  else if (n < 0x10000) w.big(0xda, n, 2)
  else w.big(0xdb, n, 4)
  w.bytes(bytes)
}

function writeBinary(w: Writer, b: Uint8Array) {
  const n = b.byteLength
  if (n < 0x100) w.byte(0xc4, n)
  else if (n < 0x10000) w.big(0xc5, n, 2)
  else w.big(0xc6, n, 4)
  w.bytes(b)
}

function writeArray(w: Writer, a: Packable[]) {
  if (a.length < 16) w.byte(0x90 | a.length)
  else if (a.length < 0x10000) w.big(0xdc, a.length, 2)
  else w.big(0xdd, a.length, 4)
  for (const item of a) write(w, item)
}

function writeMap(w: Writer, m: { [key: string]: Packable }) {
  const keys = Object.keys(m)
  if (keys.length < 16) w.byte(0x80 | keys.length)
  else if (keys.length < 0x10000) w.big(0xde, keys.length, 2)
  else w.big(0xdf, keys.length, 4)
  for (const k of keys) {
    writeString(w, k)
    write(w, m[k] ?? null)
  }
}

export function decode(bytes: Uint8Array): Packable {
  const [value] = read(bytes, 0)
  return value
}

function read(b: Uint8Array, at: number): [Packable, number] {
  const tag = b[at]
  if (tag === undefined) throw new RangeError('messagepack: truncated input')
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)

  if (tag <= 0x7f) return [tag, at + 1]
  if (tag >= 0xe0) return [tag - 0x100, at + 1]
  if ((tag & 0xf0) === 0x80) return readMap(b, at + 1, tag & 0x0f)
  if ((tag & 0xf0) === 0x90) return readArray(b, at + 1, tag & 0x0f)
  if ((tag & 0xe0) === 0xa0) return readString(b, at + 1, tag & 0x1f)

  switch (tag) {
    case 0xc0:
      return [null, at + 1]
    case 0xc2:
      return [false, at + 1]
    case 0xc3:
      return [true, at + 1]
    case 0xc4:
      return readBinary(b, at + 2, view.getUint8(at + 1))
    case 0xc5:
      return readBinary(b, at + 3, view.getUint16(at + 1))
    case 0xc6:
      return readBinary(b, at + 5, view.getUint32(at + 1))
    case 0xca:
      return [view.getFloat32(at + 1), at + 5]
    case 0xcb:
      return [view.getFloat64(at + 1), at + 9]
    case 0xcc:
      return [view.getUint8(at + 1), at + 2]
    case 0xcd:
      return [view.getUint16(at + 1), at + 3]
    case 0xce:
      return [view.getUint32(at + 1), at + 5]
    case 0xcf:
      return [Number(view.getBigUint64(at + 1)), at + 9]
    case 0xd0:
      return [view.getInt8(at + 1), at + 2]
    case 0xd1:
      return [view.getInt16(at + 1), at + 3]
    case 0xd2:
      return [view.getInt32(at + 1), at + 5]
    case 0xd3:
      return [Number(view.getBigInt64(at + 1)), at + 9]
    case 0xd9:
      return readString(b, at + 2, view.getUint8(at + 1))
    case 0xda:
      return readString(b, at + 3, view.getUint16(at + 1))
    case 0xdb:
      return readString(b, at + 5, view.getUint32(at + 1))
    case 0xdc:
      return readArray(b, at + 3, view.getUint16(at + 1))
    case 0xdd:
      return readArray(b, at + 5, view.getUint32(at + 1))
    case 0xde:
      return readMap(b, at + 3, view.getUint16(at + 1))
    case 0xdf:
      return readMap(b, at + 5, view.getUint32(at + 1))
    default:
      throw new TypeError(`messagepack: unsupported tag 0x${tag.toString(16)}`)
  }
}

function readString(b: Uint8Array, at: number, len: number): [string, number] {
  return [utf8Decoder.decode(b.subarray(at, at + len)), at + len]
}

function readBinary(b: Uint8Array, at: number, len: number): [Uint8Array, number] {
  return [b.slice(at, at + len), at + len]
}

function readArray(b: Uint8Array, at: number, len: number): [Packable[], number] {
  const out: Packable[] = []
  let cursor = at
  for (let i = 0; i < len; i++) {
    const [value, next] = read(b, cursor)
    out.push(value)
    cursor = next
  }
  return [out, cursor]
}

function readMap(b: Uint8Array, at: number, len: number): [{ [k: string]: Packable }, number] {
  const out: { [k: string]: Packable } = {}
  let cursor = at
  for (let i = 0; i < len; i++) {
    const [key, afterKey] = read(b, cursor)
    const [value, afterValue] = read(b, afterKey)
    out[String(key)] = value
    cursor = afterValue
  }
  return [out, cursor]
}
