import type { Context } from 'hono'
import type { App } from '../app.ts'
import { insensitive } from '../http.ts'
import { DEFAULT_KDF, findByEmail } from '../users.ts'

/**
 * Served from three paths. `bw` asks `/identity/accounts/prelogin/password`;
 * older clients ask `/api/accounts/prelogin`. Found by the compat suite, which
 * is the only reason we know.
 *
 * Two shapes in one body. Clients up to 2026.6 read `kdf`/`kdfIterations`;
 * from 2026.10 they read `kdfSettings` + `salt` and throw on their absence
 * ("KDF config response does not contain a valid KDF type"). The salt is the
 * client-side KDF salt, which is the lowercased email.
 */
export async function prelogin(c: Context<App>) {
  const body = insensitive(await c.req.json())
  const email = typeof body.email === 'string' ? body.email.toLowerCase() : ''
  const user = await findByEmail(c.get('db'), email)

  // An unknown email gets the defaults rather than an error: replying "no such
  // user" here would turn prelogin into an account-enumeration oracle.
  const kdfType = user?.kdf_type ?? DEFAULT_KDF.type
  const iterations = user?.kdf_iterations ?? DEFAULT_KDF.iterations
  const memory = user?.kdf_memory ?? null
  const parallelism = user?.kdf_parallelism ?? null
  return c.json({
    kdf: kdfType,
    kdfIterations: iterations,
    kdfMemory: memory,
    kdfParallelism: parallelism,
    kdfSettings: { kdfType, iterations, memory, parallelism },
    salt: email,
  })
}
