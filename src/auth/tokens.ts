import { SignJWT } from 'jose'

export const ACCESS_TOKEN_TTL = 3600

// HS256 for now. Vaultwarden signs RS256 with a generated keypair; whether stock
// clients verify the signature or treat the token as opaque is a Phase 0 finding
// (STACK.md §6) and decides whether HS256 can stay.
export async function issueAccessToken(opts: {
  secret: string
  issuer: string
  subject: string
  email: string
  deviceId: string
  scope: string
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    premium: true,
    name: opts.email,
    email: opts.email,
    email_verified: true,
    sstamp: 'phase0',
    device: opts.deviceId,
    scope: opts.scope.split(' '),
    amr: ['Application'],
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(opts.issuer)
    .setSubject(opts.subject)
    .setNotBefore(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL)
    .sign(new TextEncoder().encode(opts.secret))
}
