import type { Context } from 'hono'
import type { App } from './app.ts'
import { Notification } from './signalr/protocol.ts'

export { Notification }

/**
 * Tell a user's other devices that something changed.
 *
 * Fire-and-forget through waitUntil: a push is a convenience, and a hub that is
 * slow or unreachable must never make the write that triggered it appear to
 * fail. The client still reconciles on its next sync regardless.
 */
export function push(
  c: Context<App>,
  type: number,
  payload: Record<string, unknown>,
  userId = c.get('user').id,
): void {
  const hub = c.env.NOTIFICATIONS.get(c.env.NOTIFICATIONS.idFromName(userId))
  c.executionCtx.waitUntil(
    hub
      .fetch('https://hub/broadcast', {
        method: 'POST',
        body: JSON.stringify({
          type,
          payload: { UserId: userId, RevisionDate: new Date().toISOString(), ...payload },
        }),
      })
      .then(() => undefined)
      .catch(() => undefined),
  )
}
