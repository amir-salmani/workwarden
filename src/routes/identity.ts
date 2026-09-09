import type { Context } from 'hono'
import { Hono } from 'hono'
import { z } from 'zod'
import type { App } from '../app.ts'
import { constantTimeEquals, deriveAuthHash } from '../auth/kdf.ts'
import { ACCESS_TOKEN_TTL, issueAccessToken } from '../auth/tokens.ts'

export const identity = new Hono<App>()

const passwordGrant = z.object({
  grant_type: z.literal('password'),
  username: z.string().min(1),
  password: z.string().min(1),
  scope: z.string().default('api offline_access'),
  deviceIdentifier: z.string().min(1),
})

identity.post('/connect/token', async (c) => {
  const grant = passwordGrant.safeParse(Object.fromEntries(await c.req.formData()))
  if (!grant.success) return oauthError(c, 'unsupported_grant_type', 'Unsupported grant type')

  const { username, password, scope, deviceIdentifier } = grant.data
  const email = username.toLowerCase()

  // Phase 0 has no database. Salt is the email; Phase 1 gives each user a random
  // salt, which changes the stored hash and is a migration, not a drop-in.
  const authHash = await deriveAuthHash(password, email, c.env.AUTH_PEPPER)

  const expected = c.env.SPIKE_AUTH_HASH
  const ok =
    expected !== undefined &&
    email === c.env.SPIKE_EMAIL?.toLowerCase() &&
    constantTimeEquals(authHash, expected)
  if (!ok) return oauthError(c, 'invalid_grant', 'Username or password is incorrect. Try again')

  const accessToken = await issueAccessToken({
    secret: c.env.JWT_SECRET,
    issuer: `${new URL(c.req.url).origin}|login`,
    subject: email,
    email,
    deviceId: deviceIdentifier,
    scope,
  })

  // Key, PrivateKey and the Kdf block a real client needs arrive in Phase 1.
  // A stock client cannot complete login against this. See docs/PHASE0.md.
  return c.json({
    access_token: accessToken,
    expires_in: ACCESS_TOKEN_TTL,
    token_type: 'Bearer',
    scope,
    unofficialServer: true,
  })
})

function oauthError(c: Context<App>, error: string, message: string) {
  return c.json(
    {
      error,
      error_description: message,
      ErrorModel: { Message: message, Object: 'error' },
    },
    400,
  )
}
