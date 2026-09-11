import type { Context } from 'hono'
import { Hono } from 'hono'
import type { App } from '../app.ts'
import { verifyAccessToken } from '../auth/tokens.ts'
import { findById } from '../users.ts'

export const notifications = new Hono<App>()

/**
 * SignalR negotiation. Clients POST here first, then open the socket.
 *
 * `negotiateVersion: 1` means the client expects a connectionToken it will pass
 * back as ?id=. There is no server affinity to carry -- the Durable Object is
 * addressed by user -- so the token is the user id and the hub finds the right
 * object from the bearer token on the socket itself.
 */
notifications.post('/hub/negotiate', async (c) => {
  const user = await userFrom(c)
  if (!user) return c.body(null, 401)

  return c.json({
    negotiateVersion: 1,
    connectionId: user,
    connectionToken: user,
    availableTransports: [{ transport: 'WebSockets', transferFormats: ['Text', 'Binary'] }],
  })
})

notifications.get('/hub', async (c) => {
  const user = await userFrom(c)
  if (!user) return c.body(null, 401)
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') return c.body(null, 426)

  const hub = c.env.NOTIFICATIONS.get(c.env.NOTIFICATIONS.idFromName(user))
  return hub.fetch(c.req.raw)
})

/**
 * A browser cannot set headers on a WebSocket, so SignalR passes the token as
 * ?access_token=. Both forms are accepted; neither is trusted without
 * verification, including that the token's stamp still matches the account.
 */
async function userFrom(c: Context<App>) {
  const header = c.req.header('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : (c.req.query('access_token') ?? '')
  if (!token) return null

  const issuer = `${new URL(c.req.url).origin}|login`
  const claims = await verifyAccessToken(c.env.JWT_SECRET, issuer, token)
  if (!claims) return null

  const user = await findById(c.get('sql'), claims.sub)
  if (!user || user.security_stamp !== claims.sstamp) return null
  return user.id
}
