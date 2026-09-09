import type { Context } from 'hono'
import { Hono } from 'hono'
import { z } from 'zod'
import type { App } from '../app.ts'
import { constantTimeEquals, deriveAuthHash } from '../auth/kdf.ts'
import { ACCESS_TOKEN_TTL, issueAccessToken, randomToken } from '../auth/tokens.ts'
import { withDb } from '../db.ts'
import { findByEmail, findById, type User } from '../users.ts'

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
})

const refreshGrant = z.object({
  grant_type: z.literal('refresh_token'),
  refresh_token: z.string().min(1),
})

identity.post('/connect/token', async (c) => {
  const form = Object.fromEntries(await c.req.formData())
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
  const user = await findByEmail(sql, username)

  // Derive even when the user does not exist, so a missing account and a wrong
  // password cost the same and cannot be told apart by timing.
  const salt = user?.salt ?? username.toLowerCase()
  const authHash = await deriveAuthHash(password, salt, c.env.AUTH_PEPPER)
  if (!user || !constantTimeEquals(authHash, user.password_hash)) {
    return oauthError(c, 'invalid_grant', 'Username or password is incorrect. Try again')
  }

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
    Key: user.akey,
    PrivateKey: user.private_key,
    Kdf: user.kdf_type,
    KdfIterations: user.kdf_iterations,
    KdfMemory: user.kdf_memory,
    KdfParallelism: user.kdf_parallelism,
    ResetMasterPassword: false,
    ForcePasswordReset: false,
    MasterPasswordPolicy: { object: 'masterPasswordPolicy' },
    UserDecryptionOptions: { HasMasterPassword: true, Object: 'userDecryptionOptions' },
    unofficialServer: true,
  }
}

function oauthError(c: Ctx, error: string, message: string) {
  return c.json(
    { error, error_description: message, ErrorModel: { Message: message, Object: 'error' } },
    400,
  )
}
