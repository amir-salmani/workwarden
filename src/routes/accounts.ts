import { Hono } from 'hono'
import { z } from 'zod'
import type { App } from '../app.ts'
import { constantTimeEquals, deriveAuthHash, randomSalt } from '../auth/kdf.ts'
import { requireUser } from '../auth/session.ts'
import { apiError, insensitive } from '../http.ts'
import { DEFAULT_KDF, findByEmail, type User } from '../users.ts'
import { cipherBlob } from './ciphers.ts'
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

/**
 * Registration is closed unless the address is listed in `SIGNUP_ALLOWLIST` --
 * comma-separated, either a whole address or `@domain`. Unset means closed:
 * this server holds one person's vault, and an open signup endpoint on it is
 * free storage for strangers and accounts nobody is watching.
 */
export function signupAllowed(allowlist: string | undefined, email: string): boolean {
  return (allowlist ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => (entry.startsWith('@') ? email.endsWith(entry) : entry === email))
}

accounts.post('/register', async (c) => {
  const parsed = registration.safeParse(insensitive(await c.req.json()))
  if (!parsed.success) return apiError(c, 'Registration is missing required fields')

  const r = parsed.data
  const email = r.email.toLowerCase()
  const sql = c.get('sql')

  if (!signupAllowed(c.env.SIGNUP_ALLOWLIST, email)) {
    return apiError(c, 'Registration is closed on this server')
  }
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
  // One message for every rejection, so this cannot be used to discover which
  // accounts exist. The hint is safe: anyone holding a token already knows the
  // address, and "already claimed" was the confusing case in practice.
  const refuse = () =>
    apiError(
      c,
      'That account is not awaiting a claim. It may already have been claimed, ' +
        'in which case simply log in -- a claim token works once.',
    )

  const user = await findByEmail(sql, parsed.data.email)
  if (!user?.claim_token || user.password_hash !== null) return refuse()
  if (!constantTimeEquals(user.claim_token, parsed.data.token)) return refuse()

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

/**
 * Change the master password.
 *
 * The client does the real work: it derives a new master key, re-wraps the
 * user's symmetric key under it, and sends the re-wrapped key as `key`. The
 * server only ever sees hashes and ciphertext -- it cannot compute the new
 * `key` itself, which is the whole point.
 *
 * Rotating the security stamp invalidates every token already issued, so other
 * devices are logged out rather than left holding credentials for a password
 * that no longer exists.
 */
const passwordChange = z.object({
  masterPasswordHash: z.string().min(1),
  newMasterPasswordHash: z.string().min(1),
  key: z.string().min(1),
  masterPasswordHint: z.string().nullish(),
})

accounts.post('/password', requireUser(), async (c) => {
  const parsed = passwordChange.safeParse(insensitive(await c.req.json()))
  if (!parsed.success) return apiError(c, 'Password change is missing required fields')

  const user = c.get('user')
  const sql = c.get('sql')
  const current = await deriveAuthHash(parsed.data.masterPasswordHash, user.salt, c.env.AUTH_PEPPER)
  if (!user.password_hash || !constantTimeEquals(current, user.password_hash)) {
    return apiError(c, 'Invalid master password')
  }

  // A new salt as well, so the stored hash shares nothing with the old one.
  const salt = randomSalt()
  const next = await deriveAuthHash(parsed.data.newMasterPasswordHash, salt, c.env.AUTH_PEPPER)
  await sql`
    update users
       set password_hash = ${next}, salt = ${salt}, akey = ${parsed.data.key},
           password_hint = ${parsed.data.masterPasswordHint ?? user.password_hint},
           security_stamp = gen_random_uuid(), revision_date = now()
     where id = ${user.id}`

  return c.body(null, 200)
})

/**
 * Rotate the account encryption key.
 *
 * Every cipher, folder and Send is re-encrypted client-side under a fresh key
 * and sent back in one request; the server swaps them in atomically. A partial
 * rotation would leave a vault half-readable, so it is one transaction.
 */
const keyRotation = z.object({
  masterPasswordHash: z.string().min(1),
  key: z.string().min(1),
  privateKey: z.string().nullish(),
  ciphers: z.array(z.object({ id: z.string().uuid() }).passthrough()).default([]),
  folders: z.array(z.object({ id: z.string().uuid(), name: z.string() })).default([]),
  sends: z.array(z.object({ id: z.string().uuid(), key: z.string() })).default([]),
})

accounts.post('/key', requireUser(), async (c) => {
  const parsed = keyRotation.safeParse(insensitive(await c.req.json()))
  if (!parsed.success) return apiError(c, 'Key rotation is missing required fields')

  const user = c.get('user')
  const sql = c.get('sql')
  const current = await deriveAuthHash(parsed.data.masterPasswordHash, user.salt, c.env.AUTH_PEPPER)
  if (!user.password_hash || !constantTimeEquals(current, user.password_hash)) {
    return apiError(c, 'Invalid master password')
  }

  await sql.begin(async (tx) => {
    await tx`
      update users set akey = ${parsed.data.key},
             private_key = ${parsed.data.privateKey ?? user.private_key},
             security_stamp = gen_random_uuid(), revision_date = now()
       where id = ${user.id}`

    for (const folder of parsed.data.folders) {
      await tx`
        update folders set name = ${folder.name}, revision_date = now()
         where id = ${folder.id} and user_id = ${user.id}`
    }
    for (const send of parsed.data.sends) {
      await tx`
        update sends set akey = ${send.key}, revision_date = now()
         where id = ${send.id} and user_id = ${user.id}`
    }
    for (const raw of parsed.data.ciphers) {
      const cipher = insensitive(raw as Record<string, unknown>)
      const id = String(cipher.id)
      await tx`
        update ciphers set data = ${tx.json(cipherBlob(cipher))}, revision_date = now()
         where id = ${id} and user_id = ${user.id}`
    }
  })

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
