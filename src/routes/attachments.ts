import { Hono } from 'hono'
import type { App } from '../app.ts'
import { requireUser } from '../auth/session.ts'

export const attachments = new Hono<App>()

/**
 * Serve an attachment blob.
 *
 * The bytes are already encrypted with the attachment's own key before they
 * ever reach the server, so R2 holds ciphertext and this route streams it
 * unchanged. Access is still checked: `visible_ciphers` decides who may read
 * the cipher an attachment hangs off, so a shared attachment follows the same
 * rules as the item it belongs to.
 */
attachments.get('/:cipherId/:attachmentId', requireUser(), async (c) => {
  const { cipherId, attachmentId } = c.req.param()

  const rows = await c.get('sql')<{ id: string }[]>`
    select a.id
      from attachments a
      join visible_ciphers vc on vc.cipher_id = a.cipher_id
     where a.cipher_id = ${cipherId}
       and a.id = ${attachmentId}
       and vc.user_id = ${c.get('user').id}`
  if (rows.length === 0) return c.body(null, 404)

  const object = await c.env.ATTACHMENTS.get(`${cipherId}/${attachmentId}`)
  if (!object) return c.body(null, 404)

  return c.body(object.body, 200, {
    'content-type': 'application/octet-stream',
    'content-length': String(object.size),
    'cache-control': 'private, no-store',
  })
})
