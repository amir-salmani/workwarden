// Server-side auth hash. 10k iterations, not Vaultwarden's 600k, plus a pepper.
// FEASIBILITY.md §2.1 and §1.3: 600k costs 74 ms against a 10 ms budget, and
// server-side iterations are bypassed by anyone who steals the database anyway.
// The pepper is the part that makes a database dump useless on its own.
const ITERATIONS = 10_000

const utf8 = new TextEncoder()

/** `clientHash` is the base64 master-password hash the Bitwarden client sends. */
export async function deriveAuthHash(
  clientHash: string,
  salt: string,
  pepper: string,
): Promise<string> {
  const kdfKey = await crypto.subtle.importKey('raw', utf8.encode(clientHash), 'PBKDF2', false, [
    'deriveBits',
  ])
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: utf8.encode(salt), iterations: ITERATIONS },
    kdfKey,
    256,
  )
  const macKey = await crypto.subtle.importKey(
    'raw',
    utf8.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return base64(await crypto.subtle.sign('HMAC', macKey, derived))
}

export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function base64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

export function randomSalt(): string {
  return base64(crypto.getRandomValues(new Uint8Array(32)).buffer)
}
