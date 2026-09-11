import type { Context } from 'hono'
import { Hono } from 'hono'
import { z } from 'zod'
import type { App } from '../app.ts'
import { deriveAuthHash, randomSalt } from '../auth/kdf.ts'
import { requireUser } from '../auth/session.ts'
import type { Sql } from '../db.ts'
import { apiError, insensitive } from '../http.ts'

export const emergencyAccess = new Hono<App>()
emergencyAccess.use('*', requireUser())

export const VIEW = 0
export const TAKEOVER = 1

const INVITED = 0
const ACCEPTED = 1
const CONFIRMED = 2
const INITIATED = 3
const APPROVED = 4

type Grant = {
  id: string
  grantor_id: string
  grantee_id: string | null
  email: string | null
  key_encrypted: string | null
  type: number
  status: number
  wait_time_days: number
  ripe: boolean
}

/**
 * `ripe` is the wait timer, evaluated on read rather than by a scheduled job:
 * a grant whose wait has elapsed is already approved whether or not anything
 * ran. There is nothing to miss and nothing to catch up on after downtime.
 */
const ripeness = (sql: Sql) => sql`
  e.status = ${INITIATED}
    and e.recovery_initiated_at + make_interval(days => e.wait_time_days) <= now() as ripe`

const selectGrant = (sql: Sql) => sql`select e.*, ${ripeness(sql)} from emergency_accesses e`

const approved = (g: Grant) => g.status === APPROVED || g.ripe

async function grantFor(sql: Sql, id: string, column: 'grantor_id' | 'grantee_id', userId: string) {
  const rows = await sql<Grant[]>`
    ${selectGrant(sql)} where e.id = ${id} and ${sql(column)} = ${userId}`
  return rows[0]
}

emergencyAccess.get('/trusted', async (c) => {
  const sql = c.get('sql')
  const rows = await sql<(Grant & { grantee_name: string | null })[]>`
    select e.*, u.name as grantee_name, ${ripeness(sql)}
      from emergency_accesses e
      left join users u on u.id = e.grantee_id
     where e.grantor_id = ${c.get('user').id}`
  return list(
    rows.map((r) => ({
      ...shared(r),
      granteeId: r.grantee_id,
      email: r.email,
      name: r.grantee_name,
      object: 'emergencyAccessGranteeDetails',
    })),
  )
})

emergencyAccess.get('/granted', async (c) => {
  const sql = c.get('sql')
  const rows = await sql<(Grant & { grantor_email: string; grantor_name: string | null })[]>`
    select e.*, u.email as grantor_email, u.name as grantor_name, ${ripeness(sql)}
      from emergency_accesses e
      join users u on u.id = e.grantor_id
     where e.grantee_id = ${c.get('user').id}`
  return list(
    rows.map((r) => ({
      ...shared(r),
      grantorId: r.grantor_id,
      email: r.grantor_email,
      name: r.grantor_name,
      object: 'emergencyAccessGrantorDetails',
    })),
  )
})

const inviteInput = z.object({
  email: z.string().email(),
  type: z.coerce.number().int().min(0).max(1),
  waitTimeDays: z.coerce.number().int().min(1).max(90),
})

/**
 * There is no mail here, so an invitation can only name someone who already has
 * an account on this server, and it lands accepted -- the round trip an email
 * would carry has nowhere to go.
 */
emergencyAccess.on(['POST', 'PUT'], '/invite', async (c) => {
  const parsed = inviteInput.safeParse(insensitive(await c.req.json().catch(() => ({}))))
  if (!parsed.success) return apiError(c, 'Emergency access invite is missing required fields')

  const sql = c.get('sql')
  const grantor = c.get('user')
  const email = parsed.data.email.toLowerCase()
  if (email === grantor.email) return apiError(c, 'You cannot grant emergency access to yourself')

  const found = await sql<{ id: string }[]>`select id from users where email = ${email}`
  const grantee = found[0]
  if (!grantee) return apiError(c, 'No account on this server uses that address')

  const existing = await sql<{ id: string }[]>`
    select id from emergency_accesses
     where grantor_id = ${grantor.id} and grantee_id = ${grantee.id}`
  if (existing[0]) return apiError(c, 'That person already has emergency access')

  await sql`
    insert into emergency_accesses (grantor_id, grantee_id, email, type, status, wait_time_days)
    values (${grantor.id}, ${grantee.id}, ${email},
            ${parsed.data.type}, ${ACCEPTED}, ${parsed.data.waitTimeDays})`
  return c.body(null, 200)
})

// Kept for clients that offer the button; without mail there is nothing to resend.
emergencyAccess.post('/:id/reinvite', (c) => c.body(null, 200))

emergencyAccess.post('/:id/accept', async (c) => {
  const grant = await grantFor(c.get('sql'), c.req.param('id'), 'grantee_id', c.get('user').id)
  if (!grant || grant.status !== INVITED) return apiError(c, 'Emergency access not found', 404)
  await c.get('sql')`
    update emergency_accesses set status = ${ACCEPTED}, updated_at = now()
     where id = ${grant.id}`
  return c.body(null, 200)
})

/** The grantor wraps their account key to the grantee's public key here. */
emergencyAccess.post('/:id/confirm', async (c) => {
  const body = insensitive(await c.req.json().catch(() => ({})))
  if (typeof body.key !== 'string' || !body.key) return apiError(c, 'Missing the wrapped key')

  const grant = await grantFor(c.get('sql'), c.req.param('id'), 'grantor_id', c.get('user').id)
  if (!grant || grant.status !== ACCEPTED) return apiError(c, 'Emergency access not found', 404)
  await c.get('sql')`
    update emergency_accesses
       set status = ${CONFIRMED}, key_encrypted = ${body.key}, updated_at = now()
     where id = ${grant.id}`
  return c.body(null, 200)
})

emergencyAccess.on(['POST', 'PUT'], '/:id', async (c) => {
  const parsed = inviteInput
    .omit({ email: true })
    .safeParse(insensitive(await c.req.json().catch(() => ({}))))
  if (!parsed.success) return apiError(c, 'Emergency access update is missing required fields')

  const rows = await c.get('sql')<{ id: string }[]>`
    update emergency_accesses
       set type = ${parsed.data.type}, wait_time_days = ${parsed.data.waitTimeDays},
           updated_at = now()
     where id = ${c.req.param('id')} and grantor_id = ${c.get('user').id}
    returning id`
  return rows[0] ? c.body(null, 200) : apiError(c, 'Emergency access not found', 404)
})

// Either side can walk away, and the grantee's copy of the key goes with it.
const revoke = async (c: Context<App>) => {
  const user = c.get('user')
  await c.get('sql')`
    delete from emergency_accesses
     where id = ${c.req.param('id') ?? ''}
       and (grantor_id = ${user.id} or grantee_id = ${user.id})`
  return c.body(null, 200)
}
emergencyAccess.delete('/:id', revoke)
emergencyAccess.post('/:id/delete', revoke)

/**
 * The grantee starts the clock. The grantor can reject until it runs out; after
 * that the grant stands on its own, which is the entire point -- the owner is
 * assumed unable to answer.
 */
emergencyAccess.post('/:id/initiate', async (c) => {
  const sql = c.get('sql')
  const grant = await grantFor(sql, c.req.param('id'), 'grantee_id', c.get('user').id)
  if (!grant || grant.status !== CONFIRMED) return apiError(c, 'Emergency access not found', 404)

  await sql`
    update emergency_accesses
       set status = ${INITIATED}, recovery_initiated_at = now(), updated_at = now()
     where id = ${grant.id}`
  const grantor = await sql<{ name: string | null; email: string }[]>`
    select name, email from users where id = ${grant.grantor_id}`
  return c.json({
    id: grant.id,
    status: INITIATED,
    type: grant.type,
    waitTimeDays: grant.wait_time_days,
    email: grantor[0]?.email,
    name: grantor[0]?.name,
    object: 'emergencyAccess',
  })
})

emergencyAccess.post('/:id/approve', (c) => decide(c, APPROVED))
emergencyAccess.post('/:id/reject', (c) => decide(c, CONFIRMED))

async function decide(c: Context<App>, status: number) {
  const sql = c.get('sql')
  const grant = await grantFor(sql, c.req.param('id') ?? '', 'grantor_id', c.get('user').id)
  if (!grant || (grant.status !== INITIATED && grant.status !== APPROVED)) {
    return apiError(c, 'Emergency access not found', 404)
  }
  await sql`
    update emergency_accesses
       set status = ${status}, recovery_initiated_at = null, updated_at = now()
     where id = ${grant.id}`
  return c.body(null, 200)
}

/** Hands the grantee the wrapped key and the grantor's KDF, to reset from. */
emergencyAccess.post('/:id/takeover', async (c) => {
  const sql = c.get('sql')
  const grant = await grantFor(sql, c.req.param('id'), 'grantee_id', c.get('user').id)
  if (!grant || grant.type !== TAKEOVER || !approved(grant)) {
    return apiError(c, 'Emergency access not found', 404)
  }
  const rows = await sql<{ kdf_type: number; kdf_iterations: number }[]>`
    select kdf_type, kdf_iterations from users where id = ${grant.grantor_id}`
  return c.json({
    keyEncrypted: grant.key_encrypted,
    kdf: rows[0]?.kdf_type ?? 0,
    kdfIterations: rows[0]?.kdf_iterations ?? 600_000,
    object: 'emergencyAccessTakeover',
  })
})

const takeoverPassword = z.object({
  newMasterPasswordHash: z.string().min(1),
  key: z.string().min(1),
})

emergencyAccess.post('/:id/password', async (c) => {
  const parsed = takeoverPassword.safeParse(insensitive(await c.req.json().catch(() => ({}))))
  if (!parsed.success) return apiError(c, 'Password reset is missing required fields')

  const sql = c.get('sql')
  const grant = await grantFor(sql, c.req.param('id'), 'grantee_id', c.get('user').id)
  if (!grant || grant.type !== TAKEOVER || !approved(grant)) {
    return apiError(c, 'Emergency access not found', 404)
  }

  const salt = randomSalt()
  const hash = await deriveAuthHash(parsed.data.newMasterPasswordHash, salt, c.env.AUTH_PEPPER)
  // Rotating the stamp logs the grantor's own devices out, which is the signal
  // they get that this happened.
  await sql`
    update users
       set password_hash = ${hash}, salt = ${salt}, akey = ${parsed.data.key},
           security_stamp = gen_random_uuid(), revision_date = now()
     where id = ${grant.grantor_id}`
  await sql`
    update emergency_accesses set status = ${CONFIRMED}, recovery_initiated_at = null
     where id = ${grant.id}`
  return c.body(null, 200)
})

/** Read-only access: the vault, wrapped so only the grantee can open it. */
emergencyAccess.post('/:id/view', async (c) => {
  const sql = c.get('sql')
  const grant = await grantFor(sql, c.req.param('id'), 'grantee_id', c.get('user').id)
  if (!grant || grant.type !== VIEW || !approved(grant)) {
    return apiError(c, 'Emergency access not found', 404)
  }

  const origin = new URL(c.req.url).origin
  const rows = await sql<{ body: string }[]>`
    select json_build_object(
      'ciphers', coalesce(
        (select jsonb_agg(cipher_json(ch, ${origin}) order by ch.id)
           from ciphers ch where ch.user_id = ${grant.grantor_id} and ch.deleted_at is null),
        '[]'::jsonb),
      'keyEncrypted', ${grant.key_encrypted}::text,
      'object', 'emergencyAccessView'
    )::text as body`
  return c.body(rows[0]?.body ?? '', 200, { 'content-type': 'application/json' })
})

// No organization policies exist here; clients ask before a takeover regardless.
emergencyAccess.get('/:id/policies', () => list([]))

function shared(g: Grant) {
  return {
    id: g.id,
    status: g.ripe ? APPROVED : g.status,
    type: g.type,
    waitTimeDays: g.wait_time_days,
  }
}

function list(data: unknown[]) {
  return Response.json({ data, continuationToken: null, object: 'list' })
}
