---
type: Register
title: workwarden roadmap
description: What is open, who it waits on, and what would settle it. Updated as things close.
status: active
created: 2026-09-12
timestamp: 2026-09-12
tags: [workwarden, roadmap, open]
related:
  - ASSURANCE.md
  - BACKUP.md
  - PHASE0.md
---

# Roadmap

Everything currently open, with the evidence behind it and what would close it.
Items move out of here by being done or by being decided against — not by going
quiet. Dates are absolute so a stale line is visible as stale.

## Now

### 1. What does `cpuTimeMs` actually measure?

**Plan is Free** (confirmed 2026-09-12), so the documented budget is 10 ms per
request. Production over 24 hours, by route:

| route | median | p95 | max | n |
|---|---|---|---|---|
| `POST /api/ciphers` | 18 | 43 | 52 | 222 |
| `POST /identity/connect/token` | 13 | 33 | 53 | 94 |
| `GET /api/sync` | 11 | 25 | 34 | 87 |
| `POST /identity/accounts/prelogin/password` | 3 | 19 | 19 | 13 |
| `GET /api/config` | 7 | 13 | 14 | 55 |

**Zero `exceededCpu` outcomes** in 2,334 requests.

`GET /api/config` returns a fixed object and touches no database, and it still
reports 7 ms. A handler doing nothing cannot cost 7 ms of CPU, so the figure
includes something other than handler work — isolate startup is the obvious
candidate. That reading also explains why routes differ from each other by only
a few milliseconds while all sitting well above the limit.

**So the alarming reading is probably wrong**, and nothing should be changed on
the strength of it. What would settle it: Cloudflare's definition of `cpuTime` in
invocation logs, and whether startup is inside it.

**Until it is settled, the KDF stays as it is** — peppered 10 k, decided against
the 10 ms number ([FEASIBILITY.md §2.1](FEASIBILITY.md)). On the Free plan that
choice is conservative in the right direction.

### 2. Retiring the old Vaultwarden

`194.5.207.166` is still running and **stays running until workwarden has
earned the job** (decided 2026-09-12). Not a date — a set of conditions:

- [x] item-by-item comparison by full content, 2026-09-11
- [x] restore proven from the encrypted backup alone, on every pull request
- [ ] 30 days of ordinary daily use without data loss — earliest **2026-10-12**
- [ ] one restore drill run by hand, from the backups repository, not by CI
- [ ] every client in real use: desktop, browser extension, mobile

The backup bundle ([backups/vaultwarden/](../backups/vaultwarden/)) has been
booted and checked, so the fallback does not depend on that server surviving.

## Next

- **Attachment blobs are not in the backup.** Items and folders are; R2 blobs
  are not, and they are the only unrecoverable thing ([BACKUP.md](BACKUP.md)).
  One file today. Fixing it means giving the backup workflow Cloudflare
  credentials, which widens what a compromised workflow can reach — the reason
  it has not been done yet.
- **Emergency access has never been driven by a real client.** Eight API tests
  cover it; the `bw` compat suite does not, because it needs a second account.
- **Sends and 2FA are not in the compat suite either.** Both are tested in
  `workerd`; neither has been exercised by a stock client.
- **Second factors are TOTP only.** No WebAuthn, YubiKey or Duo.

## Deliberately not doing

- **Rotating the credentials that passed through a chat session** — declined
  2026-09-12. They are the Neon password, a `bw` session key, and a client-side
  password hash.
- **An offline clone of the backups repository** — declined 2026-09-12. Until it
  exists, every copy of the vault is inside an account that one provider can
  suspend ([FEASIBILITY.md §2.4](FEASIBILITY.md)).
- **Organizations, collections, sharing** — removed on purpose
  ([FLATTENING.md](FLATTENING.md)).
- **The web vault** — not shipped, and that is the point ([STACK.md §2.5](STACK.md)).
- **Email** — no SMTP path on Workers ([STACK.md §2.6](STACK.md)).
- **A third-party audit** — cannot be afforded, so it is disclosed instead
  ([ASSURANCE.md](ASSURANCE.md)).

## Closed

| | |
|---|---|
| 2026-09-12 | Registration closed behind `SIGNUP_ALLOWLIST`; it was open to the internet |
| 2026-09-12 | Preview databases no longer arrive holding a clone of production |
| 2026-09-12 | Backups skip a vault that has not changed; naming was adding ~330 MB/year |
| 2026-09-12 | Emergency takeover clears the grantor's second factor, which made it useless |
| 2026-09-12 | Send passwords rate-limited; they took unlimited guesses |
| 2026-09-12 | Hub stopped throwing on abrupt client disconnects (close code 1006) |
| 2026-09-12 | Login rate limiting, password change and key rotation, 2FA, file Sends, emergency access |
| 2026-09-11 | Vault cut over: 205 live items, 112 trashed, 18 folders, 0 organizations |
