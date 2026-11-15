# workwarden

A Bitwarden-client-compatible server on Cloudflare Workers, for one person —
*worker* of Cloudflare, *warden* of Bitwarden.

**For personal use only.** One account, the author's. Not a multi-tenant
service, not audited, not offered for anyone else to rely on. Self-host it if
you like the approach, knowing that the only vault it has ever kept is its
author's.

## What it is

- One Worker, one D1 database, one R2 bucket. All on the free plan.
- The Bitwarden clients are the UI: browser extension, mobile and desktop apps,
  `bw`, `rbw`. There is no web vault, on purpose: whoever serves a web vault's
  JavaScript can ship a version that steals the master password.
- 28 routes ([`docs/generated/routes.md`](docs/generated/routes.md)): login,
  sync, ciphers, folders, password change, key rotation. No organizations,
  Sends, attachments, emergency access, server-side 2FA, SSO or email.
- Registration is closed: `OWNER_EMAIL` names the one address that may
  register, once.
- Nightly, a cron trigger writes an age-encrypted export to R2. The Worker holds
  the recipient only. [`docs/BACKUP.md`](docs/BACKUP.md).

The decisions behind the shape are in [`docs/SHAVE.md`](docs/SHAVE.md); the
history that led there is in [`docs/`](docs/index.md).

## Develop

```
npm ci
cp .dev.vars.example .dev.vars     # fill in; never committed
git config core.hooksPath .githooks
npm run migrate                    # local D1
npm run dev
```

`npm test` runs in `workerd` via vitest-pool-workers against a local D1 with
the migrations applied. `npm run routes:check` fails when the route table
drifts from the app.

`compat/run.sh` drives a stock `@bitwarden/cli` against a running server —
register, login, create, sync, decrypt, folders, edit, trash, restore. Unit
tests assert the shape we chose; this asserts a real client agrees.

## Deploy

From a laptop that can `wrangler login`, with `CLOUDFLARE_ACCOUNT_ID` set:

```
npm run migrate:remote
npx wrangler secret put AUTH_PEPPER     # generate, store in the vault first
npx wrangler secret put JWT_SECRET
npx wrangler deploy
```

Losing `AUTH_PEPPER` makes every stored password hash unverifiable; the fix is
re-registering, nothing worse. Rotating `JWT_SECRET` logs every client out.

The Worker serves on `workers.dev`. It must not be bound to a custom hostname
that something else still answers on — that is how this project was frozen
once.

## Restore

```
node scripts/restore.mjs <snapshot.json.age> <identity-file> --remote
```

Into an empty database, on a Worker with the same `AUTH_PEPPER`.

## Stated limitations

A password manager should say these out loud rather than bury them.

- **Cloudflare can read what it executes.** It sees ciphertext only — but
  whoever controls the deployment controls the code. Use clients that ship
  their own code.
- **Nobody has audited this.** Bitwarden is audited annually and Vaultwarden
  twice in 2024 — one of those found an authentication bypass in code far more
  reviewed than this. [ASSURANCE.md](docs/ASSURANCE.md).
- **One account, one hosting account.** A suspended Cloudflare account costs
  the compute and the live database; the nightly snapshot in R2 is on the same
  account. Keep a copy elsewhere.
- **No live push.** Clients learn of changes when they sync, not the instant
  another device saves.

## License

MIT — see [LICENSE](LICENSE). Clean-room: no Vaultwarden source, schema, or logic
is copied. Vaultwarden is AGPLv3, and copying would make this AGPLv3 regardless
of what the LICENSE file says.
