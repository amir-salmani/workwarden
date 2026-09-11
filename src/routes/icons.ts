import { Hono } from 'hono'
import type { App } from '../app.ts'

export const icons = new Hono<App>()

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30
const MAX_ICON_BYTES = 256 * 1024

/**
 * Site icons for the client's vault list.
 *
 * The server fetches these, not the client. That is the whole point: asking
 * icons.bitwarden.net would hand a third party the list of domains in someone's
 * vault, and having the client fetch them would announce the vault's contents
 * from the user's own address. Neither is acceptable for a password manager.
 *
 * Results are cached in R2, failures included -- a domain with no icon must not
 * mean a fetch on every render.
 */
icons.get('/:domain/icon.png', async (c) => {
  const domain = c.req.param('domain').toLowerCase()
  if (!isPublicHostname(domain)) return c.body(null, 404)

  const key = `icons/${domain}`
  const cached = await c.env.ATTACHMENTS.get(key)
  if (cached) {
    // A zero-length object is the remembered "this domain has no icon".
    if (cached.size === 0) return c.body(null, 404)
    return c.body(cached.body, 200, {
      'content-type': cached.httpMetadata?.contentType ?? 'image/png',
      'cache-control': `public, max-age=${CACHE_TTL_SECONDS}`,
    })
  }

  const found = await fetchIcon(domain)
  if (!found) {
    await c.env.ATTACHMENTS.put(key, new Uint8Array(0))
    return c.body(null, 404)
  }

  await c.env.ATTACHMENTS.put(key, found.bytes, {
    httpMetadata: { contentType: found.contentType },
  })
  return c.body(found.bytes, 200, {
    'content-type': found.contentType,
    'cache-control': `public, max-age=${CACHE_TTL_SECONDS}`,
  })
})

/** Reject anything that is not a plain public hostname, so this cannot be aimed inward. */
function isPublicHostname(domain: string): boolean {
  if (!/^[a-z0-9.-]+$/.test(domain)) return false
  if (domain.length > 253 || !domain.includes('.')) return false
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return false
  if (domain.endsWith('.local') || domain.endsWith('.internal')) return false
  if (/^\d+\.\d+\.\d+\.\d+$/.test(domain)) return false
  return true
}

async function fetchIcon(domain: string) {
  for (const url of await candidates(domain)) {
    const res = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; workwarden)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)
    if (!res?.ok) continue

    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) continue

    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ICON_BYTES) continue
    return { bytes, contentType }
  }
  return null
}

/** Whatever the page declares, then the conventional locations. */
async function candidates(domain: string): Promise<string[]> {
  const fallbacks = [`https://${domain}/favicon.ico`, `https://${domain}/apple-touch-icon.png`]

  const page = await fetch(`https://${domain}/`, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; workwarden)' },
    redirect: 'follow',
    signal: AbortSignal.timeout(5000),
  }).catch(() => null)
  if (!page?.ok) return fallbacks

  const html = (await page.text().catch(() => ''))?.slice(0, 64 * 1024) ?? ''
  const declared: string[] = []
  for (const tag of html.matchAll(/<link\s[^>]*>/gi)) {
    const rel = /rel\s*=\s*["']([^"']+)["']/i.exec(tag[0])?.[1]?.toLowerCase() ?? ''
    if (
      !rel.split(/\s+/).some((r) => r === 'icon' || r === 'shortcut' || r === 'apple-touch-icon')
    ) {
      continue
    }
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag[0])?.[1]
    if (!href) continue
    try {
      declared.push(new URL(href, page.url).toString())
    } catch {
      // A malformed href is not worth failing the whole lookup over.
    }
  }
  return [...declared, ...fallbacks]
}
