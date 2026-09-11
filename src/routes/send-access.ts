import type { Context } from 'hono'
import { Hono } from 'hono'
import type { App } from '../app.ts'
import { issueSendFileToken, sendFileTokenOk } from '../auth/tokens.ts'
import { apiError } from '../http.ts'
import { blockedFor, clearFailures, recordFailure, sendKeys } from '../throttle.ts'
import { sendFileKey } from './sends.ts'

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
  const send = await reachable(c, c.req.param('accessId'))
  if (send instanceof Response) return send

  // A file Send counts when the file link is issued, not here: the client asks
  // for both, and two hits would halve every access limit.
  if (!send.json.file) await spend(c, send.id)
  const { password: _password, ...safe } = send.json
  return c.json(safe)
})

/**
 * Hand a recipient a short-lived download link. The bytes are served from a
 * separate unauthenticated route, so the link is the only credential -- and it
 * names one file and expires in five minutes.
 */
sendAccess.post('/:accessId/file/:fileId', async (c) => {
  const { accessId, fileId } = c.req.param()
  const send = await reachable(c, accessId)
  if (send instanceof Response) return send

  const file = send.json.file as { id?: string } | null
  if (file?.id !== fileId) return apiError(c, 'That Send is not available', 404)

  await spend(c, send.id)
  const origin = new URL(c.req.url).origin
  const token = await issueSendFileToken(c.env.JWT_SECRET, `${origin}|send`, send.id, fileId)
  return c.json({
    id: fileId,
    url: `${origin}/api/sends/access/file/${send.id}/${fileId}?t=${token}`,
    object: 'send-fileDownload',
  })
})

sendAccess.get('/file/:sendId/:fileId', async (c) => {
  const { sendId, fileId } = c.req.param()
  const origin = new URL(c.req.url).origin
  const ok = await sendFileTokenOk(
    c.env.JWT_SECRET,
    `${origin}|send`,
    c.req.query('t') ?? '',
    sendId,
    fileId,
  )
  if (!ok) return c.body(null, 404)

  const object = await c.env.ATTACHMENTS.get(sendFileKey(sendId, fileId))
  if (!object) return c.body(null, 404)
  return c.body(object.body, 200, {
    'content-type': 'application/octet-stream',
    'content-length': String(object.size),
    'cache-control': 'private, no-store',
  })
})

// Counted on delivery, so a failed password attempt does not burn an access.
function spend(c: Context<App>, id: string) {
  return c.get('sql')`update sends set access_count = access_count + 1 where id = ${id}`
}

type Available = {
  id: string
  json: Record<string, unknown>
  password_hash: string | null
  disabled: boolean
  expired: boolean
  exhausted: boolean
}

/** The send, or the response to return instead. */
async function reachable(c: Context<App>, accessId: string): Promise<Available | Response> {
  const sql = c.get('sql')

  const rows = await sql<Available[]>`
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
    const keys = sendKeys(accessId)
    if ((await blockedFor(c, keys)) > 0) {
      return apiError(c, 'Too many attempts on that Send. Try again later.', 429)
    }
    const body = (await c.req.json().catch(() => ({}))) as { password?: string }
    if (body.password !== send.password_hash) {
      await recordFailure(c, keys)
      return apiError(c, 'That Send is password protected', 401)
    }
    await clearFailures(c, keys)
  }
  return send
}
