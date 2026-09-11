import type { Context } from 'hono'
import { Hono } from 'hono'
import { z } from 'zod'
import type { App } from '../app.ts'
import { constantTimeEquals, deriveAuthHash } from '../auth/kdf.ts'
import { ACCESS_TOKEN_TTL, issueAccessToken, randomToken } from '../auth/tokens.ts'
import { verify as verifyTotp } from '../auth/totp.ts'
import { withDb } from '../db.ts'
import {
  blockedFor,
  clearFailures,
  loginKeys,
  recordFailure,
  tooManyAttempts,
} from '../throttle.ts'
import { findByEmail, findById, type User } from '../users.ts'
import { prelogin } from './prelogin.ts'
import { AUTHENTICATOR, secondFactorFor } from './two-factor.ts'

type Ctx = Context<App>

export const identity = new Hono<App>()
identity.use('*', withDb())

const passwordGrant = z.object({
  grant_type: z.literal('password'),
  username: z.string().min(1),
  password: z.string().min(1),
  scope: z.string().default('api offline_access'),
  deviceIdentifier: z.string().min(1),
  deviceName: z.string().optional(),
  deviceType: z.coerce.number().optional(),
  twoFactorToken: z.string().optional(),
  twoFactorProvider: z.coerce.number().optional(),
})

const refreshGrant = z.object({
  grant_type: z.literal('refresh_token'),
  refresh_token: z.string().min(1),
})

identity.post('/accounts/prelogin', prelogin)
identity.post('/accounts/prelogin/password', prelogin)

identity.post('/connect/token', async (c) => {
  // formData() throws on a request with no body, and an unauthenticated 500 on
  // the login endpoint is worse than a 400.
  let form: Record<string, unknown>
  try {
    form = Object.fromEntries(await c.req.formData())
  } catch {
    return oauthError(c, 'invalid_request', 'Malformed request body')
  }
  const sql = c.get('sql')

  const refresh = refreshGrant.safeParse(form)
  if (refresh.success) {
    const rows = await sql<{ user_id: string; identifier: string }[]>`
      select user_id, identifier from devices where refresh_token = ${refresh.data.refresh_token}`
    const device = rows[0]
    const user = device && (await findById(sql, device.user_id))
    if (!user) return oauthError(c, 'invalid_grant', 'Refresh token is invalid')
    return c.json(
      await tokenResponse(
        c,
        user,
        device.identifier,
        'api offline_access',
        refresh.data.refresh_token,
      ),
    )
  }

  const grant = passwordGrant.safeParse(form)
  if (!grant.success) return oauthError(c, 'unsupported_grant_type', 'Unsupported grant type')

  const { username, password, scope, deviceIdentifier, deviceName, deviceType } = grant.data

  // Checked before the KDF, so a locked-out caller cannot spend our CPU either.
  const keys = loginKeys(c, username)
  const wait = await blockedFor(c, keys)
  if (wait > 0) return tooManyAttempts(c, wait)

  const user = await findByEmail(sql, username)

  // Derive even when the user does not exist, so a missing account and a wrong
  // password cost the same and cannot be told apart by timing.
  const salt = user?.salt ?? username.toLowerCase()
  const authHash = await deriveAuthHash(password, salt, c.env.AUTH_PEPPER)

  // An imported account has no password hash until it is claimed. Deriving
  // anyway keeps the timing identical to a wrong password.
  if (!user?.password_hash || !constantTimeEquals(authHash, user.password_hash)) {
    await recordFailure(c, keys)
    return oauthError(c, 'invalid_grant', 'Username or password is incorrect. Try again')
  }
  // Only now, with the password proven, is the second factor asked for. Asking
  // earlier would tell an attacker which accounts exist and have 2FA.
  const factor = await secondFactorFor(sql, user.id)
  if (factor) {
    const token = grant.data.twoFactorToken
    if (!token) return twoFactorRequired(c)

    const recovered =
      factor.recovery !== null &&
      constantTimeEquals(factor.recovery, token.replace(/\s/g, '').toUpperCase())

    let step: number | null = null
    if (!recovered) {
      step = await verifyTotp(factor.secret, token)
      // A code stays valid for its whole window; without this, anyone who sees
      // it once can reuse it until the window passes.
      if (
        step !== null &&
        factor.last_used_step !== null &&
        step <= Number(factor.last_used_step)
      ) {
        step = null
      }
    }

    if (!recovered && step === null) {
      await recordFailure(c, keys)
      return twoFactorRequired(c, 'Two-step token is invalid. Try again.')
    }

    if (recovered) {
      // A recovery code is single use, and using it turns the factor off so the
      // account is reachable again.
      await sql`delete from two_factors where user_id = ${user.id} and type = ${AUTHENTICATOR}`
    } else {
      await sql`
        update two_factors set last_used_step = ${step}
         where user_id = ${user.id} and type = ${AUTHENTICATOR}`
    }
  }

  await clearFailures(c, keys)

  const refreshToken = randomToken()
  await sql`
    insert into devices (user_id, identifier, name, type, refresh_token)
    values (${user.id}, ${deviceIdentifier}, ${deviceName ?? null}, ${deviceType ?? 0}, ${refreshToken})
    on conflict (user_id, identifier) do update
      set refresh_token = excluded.refresh_token,
          name          = coalesce(excluded.name, devices.name),
          revision_date = now()`

  return c.json(await tokenResponse(c, user, deviceIdentifier, scope, refreshToken))
})

async function tokenResponse(
  c: Ctx,
  user: User,
  deviceId: string,
  scope: string,
  refreshToken: string,
) {
  const accessToken = await issueAccessToken({
    secret: c.env.JWT_SECRET,
    issuer: `${new URL(c.req.url).origin}|login`,
    user,
    deviceId,
    scope,
  })
  return {
    access_token: accessToken,
    expires_in: ACCESS_TOKEN_TTL,
    token_type: 'Bearer',
    refresh_token: refreshToken,
    scope,

    // Both casings on purpose. Clients have read these fields as PascalCase for
    // years and newer ones read camelCase; sending one alone breaks the other.
    Key: user.akey,
    key: user.akey,
    PrivateKey: user.private_key,
    privateKey: user.private_key,
    Kdf: user.kdf_type,
    kdf: user.kdf_type,
    KdfIterations: user.kdf_iterations,
    kdfIterations: user.kdf_iterations,
    KdfMemory: user.kdf_memory,
    kdfMemory: user.kdf_memory,
    KdfParallelism: user.kdf_parallelism,
    kdfParallelism: user.kdf_parallelism,
    ResetMasterPassword: false,
    resetMasterPassword: false,
    ForcePasswordReset: false,
    forcePasswordReset: false,
    MasterPasswordPolicy: { object: 'masterPasswordPolicy' },
    masterPasswordPolicy: { object: 'masterPasswordPolicy' },
    UserDecryptionOptions: decryptionOptions(user),
    userDecryptionOptions: decryptionOptions(user),
    AccountKeys: accountKeys(user),
    accountKeys: accountKeys(user),
    unofficialServer: true,
  }
}

/**
 * The client builds its account cryptographic state from this. The password
 * login strategy reads it with no null check, so omitting it throws
 * `Cannot read properties of null` after a perfectly good 200 -- which is how
 * this was found.
 *
 * Omitting signatureKeyPair and securityState declares a V1 account, and the
 * client rejects the response if exactly one of the two is present.
 */
function accountKeys(user: User) {
  if (!user.private_key || !user.public_key) return undefined
  return {
    publicKeyEncryptionKeyPair: {
      publicKey: user.public_key,
      wrappedPrivateKey: user.private_key,
    },
  }
}

// MasterPasswordUnlock is what newer clients turn into their account
// cryptographic state; without it `bw login` fails after a 200. Salt is the
// client-side KDF salt, which is the lowercased email.
function decryptionOptions(user: User) {
  const kdf = {
    kdfType: user.kdf_type,
    iterations: user.kdf_iterations,
    memory: user.kdf_memory,
    parallelism: user.kdf_parallelism,
  }
  return {
    HasMasterPassword: true,
    hasMasterPassword: true,
    MasterPasswordUnlock: {
      Kdf: kdf,
      kdf,
      MasterKeyEncryptedUserKey: user.akey,
      masterKeyEncryptedUserKey: user.akey,
      MasterKeyWrappedUserKey: user.akey,
      masterKeyWrappedUserKey: user.akey,
      Salt: user.email,
      salt: user.email,
    },
    masterPasswordUnlock: {
      kdf,
      masterKeyEncryptedUserKey: user.akey,
      masterKeyWrappedUserKey: user.akey,
      salt: user.email,
    },
    Object: 'userDecryptionOptions',
    object: 'userDecryptionOptions',
  }
}

/** The shape a Bitwarden client reads to know it should prompt for a code. */
function twoFactorRequired(c: Ctx, message = 'Two factor required.') {
  return c.json(
    {
      error: 'invalid_grant',
      error_description: message,
      ErrorModel: { Message: message, Object: 'error' },
      TwoFactorProviders: [String(AUTHENTICATOR)],
      TwoFactorProviders2: { [String(AUTHENTICATOR)]: null },
      MasterPasswordPolicy: { object: 'masterPasswordPolicy' },
    },
    400,
  )
}

function oauthError(c: Ctx, error: string, message: string) {
  return c.json(
    { error, error_description: message, ErrorModel: { Message: message, Object: 'error' } },
    400,
  )
}
