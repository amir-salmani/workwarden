# workwarden

A Bitwarden-compatible server for one person, on Cloudflare's free plan.
One Worker, one D1 database, one R2 bucket, no servers to patch. The official
Bitwarden apps are the UI.

*worker* of Cloudflare, *warden* of Bitwarden.

## Works with the real clients

Verified against the stock clients on 2026-11-16, with a 319-item vault
imported from Vaultwarden:

| Client | Version | Login, sync, read, write |
|---|---|---|
| Browser extension (Chrome) | current store build, Nov 2026 | yes |
| iOS app | current App Store build, Nov 2026 | yes |
| Android app | current Play build, Nov 2026 | yes |
| macOS app | current App Store build, Nov 2026 | yes |
| `bw` CLI | 2026.10.1 | yes |
| `rbw` | 1.15.0 | yes |

What each client turned out to need from the server, with the error it throws
when it does not get it, is in [docs/CLIENTS.md](docs/CLIENTS.md). A stock `bw`
is also driven through ten round-trips by [`compat/run.sh`](compat/run.sh).

## What it is, and is not

- 34 routes ([generated, diffed in CI](docs/generated/routes.md)): login, sync,
  items, folders, trash, password change, key rotation, device probes.
- One account. `OWNER_EMAIL` names the one address that may register, once.
  There is no second user, no organization, no sharing.
- No web vault, on purpose: whoever serves a web vault's JavaScript can ship a
  version that reads the master password. Use the apps; they carry their own code.
- No Sends, attachments, emergency access, server-side 2FA, SSO, email or live
  push. Clients learn of changes when they sync. [docs/SHAVE.md](docs/SHAVE.md)
  records what was cut and why.
- Nightly, a cron trigger writes an age-encrypted export to R2. The Worker holds
  only the public key. [docs/BACKUP.md](docs/BACKUP.md).

**Personal software.** It keeps its author's vault and nobody else's. It has not
been audited, and a password server that has not been audited should say so
first. [docs/ASSURANCE.md](docs/ASSURANCE.md) is the honest comparison with
Bitwarden and Vaultwarden. Run your own copy if you like the shape, knowing that.

## Run your own

Needs a Cloudflare account (free plan is enough), Node 24, and `age`.

**1. Fork, then make the config yours.** Five lines in
[`wrangler.jsonc`](wrangler.jsonc):

```jsonc
"routes": [{ "pattern": "vault.example.com", "custom_domain": true }],  // or delete the line to stay on workers.dev
"database_id": "<from step 2>",
"bucket_name": "<from step 2>",
"OWNER_EMAIL": "you@example.com",
"AGE_RECIPIENT": "<from step 3>"
```

**2. Create the database and the bucket.**

```
npx wrangler login
npx wrangler d1 create workwarden            # paste database_id into wrangler.jsonc
npx wrangler r2 bucket create workwarden-snapshots
npm ci && npm run migrate:remote
```

**3. Make the backup key.** The public half goes in the config; the private
half goes somewhere that is neither this laptop nor this Cloudflare account.
Paper works.

```
age-keygen -o workwarden-backup.key          # prints "Public key: age1..." → AGE_RECIPIENT
```

**4. Set the two secrets and deploy.** Keep copies of both next to the backup
key; a restore needs the same `AUTH_PEPPER`.

```
openssl rand -base64 32 | npx wrangler secret put AUTH_PEPPER
openssl rand -base64 32 | npx wrangler secret put JWT_SECRET
npx wrangler deploy
```

**5. Register the one account.** There is no sign-up form. The script does what
a client would: real Bitwarden key derivation on your machine; the master
password never leaves the process.

```
BASE=https://vault.example.com node scripts/register.mjs you@example.com
```

**6. Point the clients at it.** In any Bitwarden app: *Logging in on: self-hosted*,
server URL `https://vault.example.com`. Then import an existing vault with
`bw import bitwardenjson export.json` or the extension's *Settings → Import*.

A `custom_domain` route takes over that DNS record on deploy. Make sure nothing
else answers on the name first.

## Backup and restore

Every night at 03:17 UTC the Worker writes `<user-id>/<date>.json.age` and
`<user-id>/latest.json.age` to the bucket. Each is a Bitwarden-shaped export,
every field still ciphertext, encrypted once more to `AGE_RECIPIENT`.

To restore, deploy a fresh copy with the same `AUTH_PEPPER`, migrate, then:

```
node scripts/restore.mjs latest.json.age workwarden-backup.key --remote
```

Log in with the master password; everything is back. The items cannot be
imported anywhere else directly, because they are encrypted under your account
key; only a client holding the master password can turn them into plaintext.

## Develop

```
npm ci
cp .dev.vars.example .dev.vars        # fill in; never committed
git config core.hooksPath .githooks
npm run migrate                       # local D1
npm run dev
```

Four checks, all run by the pre-commit hook and by `ci.yml`:

| Check | Command | Catches |
|---|---|---|
| Types | `npm run typecheck` | the usual |
| Lint and format | `npm run lint` | Biome, recommended rules |
| Route surface | `npm run routes:check` | a route that silently stopped being registered; the table is read off the real app |
| Tests | `npm test` | 36 tests in `workerd` against a local D1 with migrations applied |

`compat/run.sh` drives a stock `@bitwarden/cli` against a running server
through register, login, create, sync, decrypt, folders, edit, trash, restore and
folder delete. Unit tests assert the shape we chose; this asserts a real client
agrees. [compat/README.md](compat/README.md).

## Stated limitations

- **Whoever controls the deployment controls the code.** The server sees
  ciphertext only, but it is still the thing your clients trust to hand back the
  right ciphertext. Use clients that ship their own code.
- **Nobody has audited this.** Bitwarden is audited annually; Vaultwarden's 2024
  audit found an authentication bypass in code far more reviewed than this.
- **One hosting account.** A suspended Cloudflare account takes the Worker, the
  database and the R2 snapshots together. Keep a copy of a snapshot somewhere else.
- **No live push.** A save on one device appears on another at its next sync.

## License

MIT, [LICENSE](LICENSE). Clean-room: no Vaultwarden source, schema or logic is
copied. Vaultwarden is AGPLv3, and copying would make this AGPLv3 regardless of
what the LICENSE file says.
