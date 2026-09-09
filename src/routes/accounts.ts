import { Hono } from 'hono'
import { z } from 'zod'
import type { App } from '../app.ts'
import { deriveAuthHash, randomSalt } from '../auth/kdf.ts'
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
