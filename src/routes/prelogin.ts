import type { Context } from 'hono'
import type { App } from '../app.ts'
import { insensitive } from '../http.ts'
import { DEFAULT_KDF, findByEmail } from '../users.ts'

/**
 * Served from three paths. `bw` asks `/identity/accounts/prelogin/password`;
 * older clients ask `/api/accounts/prelogin`. Found by the compat suite, which
 * is the only reason we know.
 */
export async function prelogin(c: Context<App>) {
  const body = insensitive(await c.req.json())
  const email = typeof body.email === 'string' ? body.email : ''
  const user = await findByEmail(c.get('sql'), email)

  // An unknown email gets the defaults rather than an error: replying "no such
  // user" here would turn prelogin into an account-enumeration oracle.
  return c.json({
    kdf: user?.kdf_type ?? DEFAULT_KDF.type,
    kdfIterations: user?.kdf_iterations ?? DEFAULT_KDF.iterations,
    kdfMemory: user?.kdf_memory ?? null,
    kdfParallelism: user?.kdf_parallelism ?? null,
  })
}
