/**
 * RFC 6238 time-based one-time passwords, verified server-side.
 *
 * Bitwarden clients never verify a login second factor themselves -- they send
 * the code and the server decides. Six digits, SHA-1, 30-second steps, because
 * that is what every authenticator app produces.
 */
const STEP_SECONDS = 30
const DIGITS = 6

/** Codes from one step either side are accepted, for clock drift. */
const DRIFT_STEPS = 1

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function randomSecret(bytes = 20): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(bytes)))
}

export function stepFor(at: number = Date.now()): number {
  return Math.floor(at / 1000 / STEP_SECONDS)
}

export async function codeFor(secret: string, step: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    base32Decode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const counter = new Uint8Array(8)
  new DataView(counter.buffer).setBigUint64(0, BigInt(step))
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter))

  // Dynamic truncation: the low nibble of the last byte picks the offset.
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f
  const binary =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    (((mac[offset + 1] ?? 0) & 0xff) << 16) |
    (((mac[offset + 2] ?? 0) & 0xff) << 8) |
    ((mac[offset + 3] ?? 0) & 0xff)
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}

/**
 * Returns the step a code belongs to, or null. The caller must reject a step it
 * has already accepted: without that, a code stays usable for its whole window
 * and anyone who sees it once can reuse it.
 */
export async function verify(
  secret: string,
  code: string,
  now: number = Date.now(),
): Promise<number | null> {
  const cleaned = code.replace(/\s/g, '')
  if (!/^[0-9]{6}$/.test(cleaned)) return null

  const current = stepFor(now)
  for (let drift = -DRIFT_STEPS; drift <= DRIFT_STEPS; drift++) {
    const step = current + drift
    if (timingSafeEquals(await codeFor(secret, step), cleaned)) return step
  }
  return null
}

function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(input: string): Uint8Array {
  const cleaned = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '')
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of cleaned) {
    const index = BASE32.indexOf(ch)
    if (index === -1) throw new TypeError(`totp: ${ch} is not base32`)
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}
