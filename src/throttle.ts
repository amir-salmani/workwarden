import type { Context } from 'hono'
import type { App } from './app.ts'

/**
 * Helpers for the failure counter. The Durable Object that backs it lives in
 * throttle-object.ts, because route modules are also loaded in plain Node by
 * scripts/route-surface.mjs, where `cloudflare:workers` does not resolve.
 */

export const LOGIN_LIMIT = 10
const LOGIN_WINDOW_SECONDS = 300

function bucket(c: Context<App>, key: string) {
  return c.env.THROTTLE.get(c.env.THROTTLE.idFromName(key))
}

/**
 * Both the account and the source address are counted. Per-account alone lets
 * one host work through many accounts; per-address alone lets a botnet grind a
 * single account.
 */
export function loginKeys(c: Context<App>, email: string): string[] {
  const ip = c.req.header('cf-connecting-ip') ?? 'unknown'
  return [`login:email:${email.toLowerCase()}`, `login:ip:${ip}`]
}

export async function blockedFor(c: Context<App>, keys: string[]): Promise<number> {
  const waits = await Promise.all(
    keys.map((k) => bucket(c, k).retryAfter(LOGIN_LIMIT, LOGIN_WINDOW_SECONDS)),
  )
  return Math.max(0, ...waits)
}

export async function recordFailure(c: Context<App>, keys: string[]): Promise<void> {
  await Promise.all(keys.map((k) => bucket(c, k).fail(LOGIN_LIMIT, LOGIN_WINDOW_SECONDS)))
}

export async function clearFailures(c: Context<App>, keys: string[]): Promise<void> {
  await Promise.all(keys.map((k) => bucket(c, k).clear()))
}

/** 429 with Retry-After, in the error shape Bitwarden clients already parse. */
export function tooManyAttempts(c: Context<App>, seconds: number) {
  return c.json(
    {
      error: 'invalid_grant',
      error_description: 'Too many failed attempts. Try again later.',
      ErrorModel: { Message: 'Too many failed attempts. Try again later.', Object: 'error' },
    },
    429,
    { 'retry-after': String(seconds) },
  )
}
