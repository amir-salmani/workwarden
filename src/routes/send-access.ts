import { Hono } from 'hono'
import type { App } from '../app.ts'
import { apiError } from '../http.ts'

export const sendAccess = new Hono<App>()

/**
 * Anonymous access to a Send. No session: the recipient has a link, not an
 * account.
 *
 * What comes back is still ciphertext. The key lives in the URL fragment, which
 * a browser never transmits, so this route hands over data it cannot read --
 * which is what makes an anonymous Send safe to serve at all.
 */
sendAccess.post('/:accessId', async (c) => {
  const accessId = c.req.param('accessId')
  const sql = c.get('sql')

  const rows = await sql<
    {
      id: string
      json: Record<string, unknown>
      password_hash: string | null
      disabled: boolean
      expired: boolean
      exhausted: boolean
    }[]
  >`
    select s.id, sd.json, s.password_hash, s.disabled,
           (s.expiration_date is not null and s.expiration_date < now())
             or s.deletion_date < now() as expired,
           (s.max_access_count is not null and s.access_count >= s.max_access_count) as exhausted
      from sends s
      join send_details sd on sd.id = s.id
     where replace(s.id::text, '-', '') = ${accessId}`

  const send = rows[0]
  // One response for missing, disabled, expired and exhausted alike: telling
  // them apart would confirm that a link once existed.
  if (!send || send.disabled || send.expired || send.exhausted) {
    return apiError(c, 'That Send is not available', 404)
  }

  if (send.password_hash) {
    const body = (await c.req.json().catch(() => ({}))) as { password?: string }
    if (body.password !== send.password_hash) {
      return apiError(c, 'That Send is password protected', 401)
    }
  }

  // Counted on delivery, so a failed password attempt does not burn an access.
  await sql`update sends set access_count = access_count + 1 where id = ${send.id}`

  const { password: _password, ...safe } = send.json
  return c.json(safe)
})
