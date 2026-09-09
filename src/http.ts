import type { Context } from 'hono'
import type { App } from './app.ts'

/**
 * Bitwarden clients have shipped both `masterPasswordHash` and
 * `MasterPasswordHash` over the years, and older ones still send the capitalised
 * form. Lower-casing the first character of every top-level key makes one
 * schema handle both.
 */
export function insensitive(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body)) out[k.charAt(0).toLowerCase() + k.slice(1)] = v
  return out
}

export function apiError(c: Context<App>, message: string, status = 400) {
  return c.json(
    {
      message,
      validationErrors: {},
      exceptionMessage: null,
      exceptionStackTrace: null,
      innerExceptionMessage: null,
      object: 'error',
    },
    status as 400,
  )
}
