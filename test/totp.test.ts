import { expect, it } from 'vitest'
import { base32Decode, base32Encode, codeFor, stepFor, verify } from '../src/auth/totp.ts'

// RFC 6238 test vectors, SHA-1, secret "12345678901234567890" in base32.
const RFC_SECRET = base32Encode(new TextEncoder().encode('12345678901234567890'))

it('matches the RFC 6238 vectors', async () => {
  const vectors: [number, string][] = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ]
  for (const [seconds, expected] of vectors) {
    expect(await codeFor(RFC_SECRET, stepFor(seconds * 1000)), String(seconds)).toBe(expected)
  }
})

it('round-trips base32', () => {
  const bytes = new Uint8Array([0, 1, 127, 128, 255, 42])
  expect(base32Decode(base32Encode(bytes))).toEqual(bytes)
})

it('accepts the current code and reports its step', async () => {
  const now = Date.now()
  const step = stepFor(now)
  const code = await codeFor(RFC_SECRET, step)
  expect(await verify(RFC_SECRET, code, now)).toBe(step)
})

it('tolerates one step of clock drift either way', async () => {
  const now = Date.now()
  const step = stepFor(now)
  for (const drift of [-1, 1]) {
    const code = await codeFor(RFC_SECRET, step + drift)
    expect(await verify(RFC_SECRET, code, now), `drift ${drift}`).toBe(step + drift)
  }
})

it('rejects a code two steps away, and anything malformed', async () => {
  const now = Date.now()
  const far = await codeFor(RFC_SECRET, stepFor(now) + 2)
  expect(await verify(RFC_SECRET, far, now)).toBeNull()

  for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 56 78']) {
    expect(await verify(RFC_SECRET, bad, now), bad).toBeNull()
  }
})

it('ignores spacing in a code, because apps display it grouped', async () => {
  const now = Date.now()
  const code = await codeFor(RFC_SECRET, stepFor(now))
  expect(await verify(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, now)).not.toBeNull()
})
