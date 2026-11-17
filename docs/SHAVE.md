---
type: Decision Record
title: One user, D1, free plan
description: The 2026-11-15 shave — what was cut from workwarden, what replaced Postgres, and the two decisions that made the free plan fit.
status: settled
created: 2026-11-15
timestamp: 2026-11-15
tags: [workwarden, d1, free-plan, single-user]
related:
  - history/FEASIBILITY.md
  - history/STORAGE.md
  - history/STACK.md
  - BACKUP.md
  - generated/routes.md
---

# One user, D1, free plan

Decided 2026-11-15, when the project was revived to replace the self-hosted
Vaultwarden for its author's own vault. Constraints set by the owner: free plan
only; one email; no SSO, email OTP, organizations or anything else that exists
for a second person.

## What was cut

2,970 lines of `src/` became 1,197. Gone: Sends, emergency access, server-side
2FA, favicon proxy, attachments, the SignalR hub over a Durable Object (live
sync — clients poll `revision-date` instead), the login-throttle Durable Object
(a Cloudflare rate-limit rule on `/identity/connect/token` does the same for
free), registration allowlist and the imported-account claim flow (`OWNER_EMAIL`,
once), and every Neon-specific script and workflow.

The compat suite stayed. It is the one thing of real value from the first
build: it proved the crypto and the wire format against a stock client, and it
still does.

## Storage: D1, not Postgres, not KV

[STORAGE.md](history/STORAGE.md) chose external Postgres on the exit path. The exit path
is now the nightly export ([BACKUP.md](BACKUP.md)), which is restorable
anywhere a Bitwarden client can import, so the database only has to be free,
consistent and dumpable.

| | D1 | KV |
|---|---|---|
| free writes/day | 100,000 | 1,000 |
| consistency | strong | eventual — a save on the phone reads back stale on the laptop for up to a minute |
| dump | `wrangler d1 export` | key by key |

A password manager cannot have the second row. Schema:
[`db/migrations/0001_init.sql`](../db/migrations/0001_init.sql), four tables.
The wire format that Postgres views used to build lives in
[`src/wire.ts`](../src/wire.ts); `/api/sync` assembles its JSON in the Worker.
Every write that touches more than one row is one `db.batch`, which D1 runs as
one transaction.

## The two decisions that make 10 ms enough

1. **No PBKDF2 iterations on the server worth counting.** The client already runs
   600k (or Argon2) on the master password; the server receives 256 random bits.
   Iterating further buys nothing — what protects the stored verifier against a
   database dump is the pepper, which lives in a Worker secret. The server runs
   10k iterations plus HMAC with the pepper: ~3 ms, measured in
   [PHASE0.md](history/PHASE0.md).
2. **Sync is built in the Worker.** 320 items is roughly 300 KB of JSON and
   1–3 ms of CPU. The D1 round-trip is I/O and does not count against the
   budget.

## Deploy rule

`wrangler.jsonc` names no custom hostname. The Worker lives on `workers.dev`
until the Vaultwarden it replaces is exported, backed up and deleted. The
project was frozen once because a documentation commit re-bound
`vault.amirsalmani.com`; that cannot recur if the name is not in the file.
