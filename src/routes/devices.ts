import { Hono } from 'hono'
import type { App } from '../app.ts'
import { requireUser } from '../auth/session.ts'
import { findByEmail } from '../users.ts'

export const devices = new Hono<App>()

/**
 * Asked before login by the mobile apps and newer CLIs: "have you seen this
 * device for this email?" Drives trusted-device flows we do not have, so a
 * truthful answer is all that is needed.
 */
devices.get('/knowndevice', async (c) => {
  const identifier = c.req.header('X-Device-Identifier') ?? ''
  const encoded = c.req.header('X-Request-Email') ?? ''
  let email = ''
  try {
    email = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))
  } catch {
    return c.json(false)
  }
  const user = email && (await findByEmail(c.get('db'), email))
  if (!user || !identifier) return c.json(false)
  const row = await c
    .get('db')
    .prepare('select 1 as one from devices where user_id = ? and identifier = ?')
    .bind(user.id, identifier)
    .first()
  return c.json(row !== null)
})

// Push registration. There is no push here; clients poll. Answering 200 keeps
// the apps from treating the missing route as a broken server.
devices.put('/identifier/:id/token', requireUser(), (c) => c.body(null, 200))
devices.on(['PUT', 'POST'], '/identifier/:id/clear-token', requireUser(), (c) => c.body(null, 200))
