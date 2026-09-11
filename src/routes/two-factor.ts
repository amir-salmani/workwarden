import type { Context } from 'hono'
import { Hono } from 'hono'
import { z } from 'zod'
import type { App } from '../app.ts'
import { constantTimeEquals, deriveAuthHash } from '../auth/kdf.ts'
import { requireUser } from '../auth/session.ts'
import { randomSecret, verify } from '../auth/totp.ts'
import type { Sql } from '../db.ts'
import { apiError, insensitive } from '../http.ts'

export const twoFactor = new Hono<App>()
twoFactor.use('*', requireUser())

/** 0 is Bitwarden's authenticator (TOTP) provider. */
export const AUTHENTICATOR = 0

export type SecondFactor = {
  user_id: string
  type: number
  enabled: boolean
  secret: string
  recovery: string | null
  last_used_step: string | null
}

export async function secondFactorFor(sql: Sql, userId: string): Promise<SecondFactor | undefined> {
  const rows = await sql<SecondFactor[]>`
    select * from two_factors where user_id = ${userId} and type = ${AUTHENTICATOR} and enabled`
  return rows[0]
}

/**
 * Every management call re-proves the master password. A stolen session token
 * must not be enough to turn the second factor off -- that is the one thing it
 * exists to survive.
 */
async function passwordOk(c: Context<App>, hash: unknown) {
  const user = c.get('user')
  if (typeof hash !== 'string' || !user.password_hash) return false
  const derived = await deriveAuthHash(hash, user.salt, c.env.AUTH_PEPPER)
  return constantTimeEquals(derived, user.password_hash)
}

twoFactor.get('/', async (c) => {
  const rows = await c.get('sql')<{ type: number; enabled: boolean }[]>`
    select type, enabled from two_factors where user_id = ${c.get('user').id}`
  return c.json({
    data: rows.map((r) => ({ type: r.type, enabled: r.enabled, object: 'twoFactorProvider' })),
    continuationToken: null,
    object: 'list',
  })
})

/** Hands back a secret to put in an authenticator app; not yet enabled. */
twoFactor.post('/get-authenticator', async (c) => {
  const body = insensitive(await c.req.json().catch(() => ({})))
  if (!(await passwordOk(c, body.masterPasswordHash))) return apiError(c, 'Invalid master password')

  const sql = c.get('sql')
  const user = c.get('user')
  const rows = await sql<{ secret: string; enabled: boolean }[]>`
    select secret, enabled from two_factors
     where user_id = ${user.id} and type = ${AUTHENTICATOR}`

  let secret = rows[0]?.secret
  if (!secret) {
    secret = randomSecret()
    await sql`
      insert into two_factors (user_id, type, enabled, secret)
      values (${user.id}, ${AUTHENTICATOR}, false, ${secret})
      on conflict (user_id, type) do update set secret = excluded.secret`
  }
  return c.json({
    enabled: rows[0]?.enabled ?? false,
    key: secret,
    object: 'twoFactorAuthenticator',
  })
})

const enableInput = z.object({
  masterPasswordHash: z.string().min(1),
  key: z.string().min(1),
  token: z.string().min(6),
})

/** Enabling requires a working code, so nobody locks themselves out. */
twoFactor.post('/authenticator', async (c) => {
  const parsed = enableInput.safeParse(insensitive(await c.req.json().catch(() => ({}))))
  if (!parsed.success) return apiError(c, 'Two-step login setup is missing required fields')
  if (!(await passwordOk(c, parsed.data.masterPasswordHash))) {
    return apiError(c, 'Invalid master password')
  }

  const step = await verify(parsed.data.key, parsed.data.token)
  if (step === null) return apiError(c, 'That code is not valid. Check your authenticator app.')

  const recovery = randomSecret(16)
  await c.get('sql')`
    insert into two_factors (user_id, type, enabled, secret, recovery, last_used_step)
    values (${c.get('user').id}, ${AUTHENTICATOR}, true, ${parsed.data.key}, ${recovery}, ${step})
    on conflict (user_id, type) do update
      set enabled = true, secret = excluded.secret,
          recovery = coalesce(two_factors.recovery, excluded.recovery),
          last_used_step = excluded.last_used_step`

  const saved = await c.get('sql')<{ recovery: string }[]>`
    select recovery from two_factors where user_id = ${c.get('user').id} and type = ${AUTHENTICATOR}`
  return c.json({
    enabled: true,
    key: parsed.data.key,
    recoveryCode: saved[0]?.recovery ?? recovery,
    object: 'twoFactorAuthenticator',
  })
})

twoFactor.on(['POST', 'PUT'], '/disable', async (c) => {
  const body = insensitive(await c.req.json().catch(() => ({})))
  if (!(await passwordOk(c, body.masterPasswordHash))) return apiError(c, 'Invalid master password')

  const type = Number(body.type ?? AUTHENTICATOR)
  await c.get('sql')`
    delete from two_factors where user_id = ${c.get('user').id} and type = ${type}`
  return c.json({ enabled: false, type, object: 'twoFactorProvider' })
})
