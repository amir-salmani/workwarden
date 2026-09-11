import { Hono } from 'hono'
import { z } from 'zod'
import type { App } from '../app.ts'
import { constantTimeEquals, deriveAuthHash, randomSalt } from '../auth/kdf.ts'
import { requireUser } from '../auth/session.ts'
import { apiError, insensitive } from '../http.ts'
import { DEFAULT_KDF, findByEmail, type User } from '../users.ts'
import { prelogin } from './prelogin.ts'

export const accounts = new Hono<App>()

const registration = z.object({
  email: z.string().email(),
  name: z.string().nullish(),
  masterPasswordHash: z.string().min(1),
  masterPasswordHint: z.string().nullish(),
  key: z.string().min(1),
  keys: z.object({ publicKey: z.string(), encryptedPrivateKey: z.string() }).nullish(),
  kdf: z.number().nullish(),
  kdfIterations: z.number().nullish(),
  kdfMemory: z.number().nullish(),
  kdfParallelism: z.number().nullish(),
})

accounts.post('/register', async (c) => {
  const parsed = registration.safeParse(insensitive(await c.req.json()))
  if (!parsed.success) return apiError(c, 'Registration is missing required fields')

  const r = parsed.data
  const email = r.email.toLowerCase()
  const sql = c.get('sql')

  if (await findByEmail(sql, email)) return apiError(c, 'User already exists')

  const salt = randomSalt()
  const passwordHash = await deriveAuthHash(r.masterPasswordHash, salt, c.env.AUTH_PEPPER)

  await sql`
    insert into users (
      email, name, password_hash, salt, password_hint,
      kdf_type, kdf_iterations, kdf_memory, kdf_parallelism,
      akey, private_key, public_key
    ) values (
      ${email}, ${r.name ?? null}, ${passwordHash}, ${salt}, ${r.masterPasswordHint ?? null},
      ${r.kdf ?? DEFAULT_KDF.type}, ${r.kdfIterations ?? DEFAULT_KDF.iterations},
      ${r.kdfMemory ?? null}, ${r.kdfParallelism ?? null},
      ${r.key}, ${r.keys?.encryptedPrivateKey ?? null}, ${r.keys?.publicKey ?? null}
    )`

  return c.body(null, 200)
})

accounts.post('/prelogin', prelogin)

/**
 * Redeem a one-time token issued when a vault was imported from Vaultwarden,
 * setting the password hash that server could not hand over. See
 * docs/MIGRATION.md.
 *
 * `masterPasswordHash` is the same value a normal login sends: the client-side
 * hash of the master password. The server still never sees the password, and
 * the vault's key material is untouched -- this only establishes how the
 * account authenticates from now on.
 */
const claim = z.object({
  email: z.string().email(),
  token: z.string().min(16),
  masterPasswordHash: z.string().min(1),
})

accounts.post('/claim', async (c) => {
  const parsed = claim.safeParse(insensitive(await c.req.json()))
  if (!parsed.success) return apiError(c, 'Claim is missing required fields')

  const sql = c.get('sql')
  const user = await findByEmail(sql, parsed.data.email)
  if (!user?.claim_token || user.password_hash !== null) {
    return apiError(c, 'That account is not awaiting a claim')
  }
  if (!constantTimeEquals(user.claim_token, parsed.data.token)) {
    return apiError(c, 'That account is not awaiting a claim')
  }

  const passwordHash = await deriveAuthHash(
    parsed.data.masterPasswordHash,
    user.salt,
    c.env.AUTH_PEPPER,
  )
  await sql`
    update users
       set password_hash = ${passwordHash}, claim_token = null, claimed_at = now()
     where id = ${user.id}`

  return c.body(null, 200)
})

accounts.get('/profile', requireUser(), (c) => c.json(profile(c.get('user'))))

accounts.get('/revision-date', requireUser(), (c) =>
  c.body(String(c.get('user').revision_date.getTime())),
)

export function profile(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: true,
    premium: true,
    premiumFromOrganization: false,
    masterPasswordHint: user.password_hint,
    culture: 'en-US',
    twoFactorEnabled: false,
    key: user.akey,
    privateKey: user.private_key,
    securityStamp: user.security_stamp,
    forcePasswordReset: false,
    usesKeyConnector: false,
    avatarColor: null,
    creationDate: user.created_at.toISOString(),
    organizations: [],
    providers: [],
    providerOrganizations: [],
    object: 'profile',
  }
}
