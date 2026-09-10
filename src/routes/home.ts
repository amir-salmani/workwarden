import { Hono } from 'hono'
import type { App } from '../app.ts'

export const home = new Hono<App>()

// Static text, no scripts, no password field. This is deliberately NOT a web
// vault: FEASIBILITY.md §2.3 -- whoever serves the vault's JavaScript can
// exfiltrate the master password, and not serving it removes that hole rather
// than mitigating it. Do not grow this page into a login form.
const PAGE = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>workwarden</title>
<style>
  :root { color-scheme: dark light }
  body { margin: 0 auto; padding: 3rem 1.5rem; max-width: 42rem;
         font: 16px/1.6 ui-sans-serif, system-ui, sans-serif }
  code { font-family: ui-monospace, monospace; font-size: .95em }
  h1 { font-size: 1.4rem; margin-bottom: .25rem }
  p.sub { margin-top: 0; opacity: .7 }
  li { margin: .3rem 0 }
</style>
<h1>workwarden</h1>
<p class="sub">A Bitwarden-compatible server. This host is an API, not a web vault.</p>

<p>There is no web interface here on purpose. Whoever serves a web vault's
JavaScript can silently ship a version that steals your master password, so this
server does not serve one. Use a client that ships its own code:</p>

<ul>
  <li>the Bitwarden browser extension, desktop or mobile app</li>
  <li>the <code>bw</code> command line client</li>
</ul>

<p>Point it at this server by setting the self-hosted environment URL to
<code>https://vault.amirsalmani.com</code> before logging in.</p>

<p><a href="https://github.com/amir-salmani/workwarden">Source, threat model and
stated limitations</a>.</p>
`

home.get('/', (c) => c.html(PAGE))

// Browsers ask for these; answering keeps the log readable.
home.get('/favicon.ico', (c) => c.body(null, 204))
home.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /\n'))
