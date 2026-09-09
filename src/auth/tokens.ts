import { jwtVerify, SignJWT } from 'jose'
import type { User } from '../users.ts'

export const ACCESS_TOKEN_TTL = 3600

// HS256 for now. Vaultwarden signs RS256 with a generated keypair; whether stock
// clients verify the signature or treat the token as opaque is still open
// (STACK.md §6) and decides whether HS256 can stay. It costs 1 ms (PHASE0.md).
const ALG = 'HS256'

export type AccessClaims = {
  sub: string
  email: string
  sstamp: string
  device: string
  scope: string[]
}

export async function issueAccessToken(opts: {
  secret: string
  issuer: string
  user: User
  deviceId: string
  scope: string
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    premium: true,
    name: opts.user.name ?? opts.user.email,
    email: opts.user.email,
    email_verified: true,
    sstamp: opts.user.security_stamp,
    device: opts.deviceId,
    scope: opts.scope.split(' '),
    amr: ['Application'],
  })
    .setProtectedHeader({ alg: ALG })
    .setIssuer(opts.issuer)
    .setSubject(opts.user.id)
    .setNotBefore(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL)
    .sign(new TextEncoder().encode(opts.secret))
}

export async function verifyAccessToken(
  secret: string,
  issuer: string,
  token: string,
): Promise<AccessClaims | undefined> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { issuer })
    return payload as unknown as AccessClaims
  } catch {
    return undefined
  }
}

export function randomToken(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(48))))
}
