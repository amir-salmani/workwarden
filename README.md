# workwarden

A Bitwarden-client-compatible server on Cloudflare Workers — *worker* of
Cloudflare, *warden* of Bitwarden. Serving `vault.amirsalmani.com`.

**For personal use only.** This runs one person's vault at
`vault.amirsalmani.com`. It is not a multi-tenant service, it has not been
audited, and it is not offered for anyone else to rely on. Self-host it if you
like the approach, but do so understanding that the only vault it has ever had
to keep is its author's.

## Scope

A single-user, self-hosted Bitwarden-compatible server. Not a product, not a
service, and not a drop-in replacement for a Bitwarden subscription. There is no
signup, no billing, no support, and no promise of compatibility with any client
version other than the ones tested here.

## Read first

[`docs/`](docs/index.md) holds the decisions taken before any code:
[feasibility](docs/FEASIBILITY.md), [storage](docs/STORAGE.md),
[stack](docs/STACK.md). Two of them are expensive to reverse later — the
server-side KDF cost, and how `/sync` is served.

The short version: two mature projects already do "Vaultwarden on Workers."
Neither implements organizations, collections, or sharing, and neither has a
published threat model or a client-compatibility test suite. That gap is the
project.

## Develop

```
npm ci
cp .dev.vars.example .dev.vars     # fill in; never committed
git config core.hooksPath .githooks
npm run dev
```

`npm test` runs in `workerd` via vitest-pool-workers, not in Node. `npm run
routes` rewrites the route table and `npm run routes:check` fails when it drifts
from the app.

## Reproduce the measurements

```
node bench/limits.mjs
```

Prints the CPU cost of the server-side password hash and of `/api/sync`
serialization against the 10 ms free-plan budget.

## Stated limitations

A password manager should say these out loud rather than bury them.

- **Cloudflare can read what it executes.** The zero-knowledge model means it
  sees ciphertext only — but whoever controls the deployment controls the code.
  The web vault is deliberately not shipped for this reason
  ([STACK.md §2.5](docs/STACK.md)); use native clients and the browser extension,
  which ship their own code.
- **CI can deploy modified server code.** The Cloudflare API token lives in
  GitHub Secrets. Not fully closable while CI deploys.
- **There is no email.** Nothing here can send one, so an emergency-access
  invite only reaches someone who already has an account on this server, and a
  grantor learns that recovery started by opening a client, not from an inbox.
- **Nobody has audited this.** Bitwarden is audited annually and Vaultwarden
  twice in 2024 — one of those found an authentication bypass in code far more
  reviewed than this. [ASSURANCE.md](docs/ASSURANCE.md) sets out what that means
  and what is done instead.
- **The hosting account carries sanctions risk.**
  [FEASIBILITY.md §1.7](docs/FEASIBILITY.md). Storage lives outside Cloudflare so
  a suspension costs the compute, not the vault — but never make this the only
  copy.

## License

MIT — see [LICENSE](LICENSE). Clean-room: no Vaultwarden source, schema, or logic
is copied. Vaultwarden is AGPLv3, and copying would make this AGPLv3 regardless
of what the LICENSE file says.
