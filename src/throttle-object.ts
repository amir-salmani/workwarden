import { DurableObject } from 'cloudflare:workers'

/**
 * Failure counting for anything guessable.
 *
 * Without this, `/identity/connect/token` accepts unlimited password guesses.
 * The client-side KDF makes each guess expensive for an attacker, but expensive
 * is not the same as bounded, and a weak master password falls to a patient
 * script. Vaultwarden ships a login rate limit for the same reason.
 *
 * Counted in a Durable Object because Workers have no shared memory: a counter
 * in an isolate is per-isolate, which is no limit at all.
 */

export class Throttle extends DurableObject {
  /** Records a failure and reports whether the caller is now locked out. */
  async fail(limit: number, windowSeconds: number): Promise<number> {
    const now = Date.now()
    const cutoff = now - windowSeconds * 1000
    const recent = ((await this.ctx.storage.get<number[]>('failures')) ?? []).filter(
      (at) => at > cutoff,
    )
    recent.push(now)
    await this.ctx.storage.put('failures', recent.slice(-limit * 2))
    return recent.length
  }

  /** Seconds to wait, or 0 when the caller may try again now. */
  async retryAfter(limit: number, windowSeconds: number): Promise<number> {
    const now = Date.now()
    const cutoff = now - windowSeconds * 1000
    const recent = ((await this.ctx.storage.get<number[]>('failures')) ?? []).filter(
      (at) => at > cutoff,
    )
    if (recent.length < limit) return 0
    const oldest = recent[0] ?? now
    return Math.max(1, Math.ceil((oldest + windowSeconds * 1000 - now) / 1000))
  }

  /** A success clears the record, so ordinary typos never accumulate. */
  async clear(): Promise<void> {
    await this.ctx.storage.delete('failures')
  }
}
