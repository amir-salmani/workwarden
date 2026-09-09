import type { MiddlewareHandler } from 'hono'
import type { App } from '../app.ts'
import { findById } from '../users.ts'
import { verifyAccessToken } from './tokens.ts'

/**
 * Bearer auth for `/api`. The token's `sstamp` is checked against the user's
 * current security stamp, so rotating the stamp invalidates every token already
 * issued -- which is how a password change logs other devices out.
 */
export function requireUser(): MiddlewareHandler<App> {
  return async (c, next) => {
    const header = c.req.header('Authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token) return c.body(null, 401)

    const issuer = `${new URL(c.req.url).origin}|login`
    const claims = await verifyAccessToken(c.env.JWT_SECRET, issuer, token)
    if (!claims) return c.body(null, 401)

    const user = await findById(c.get('sql'), claims.sub)
    if (!user || user.security_stamp !== claims.sstamp) return c.body(null, 401)

    c.set('user', user)
    c.set('deviceId', claims.device)
    await next()
  }
}
