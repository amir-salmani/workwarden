---
type: Evidence
title: Bitwarden CLI compatibility — findings
description: What driving a stock `bw` at workwarden has proved, and where it currently stops.
status: open
created: 2026-09-10
timestamp: 2026-09-10
tags: [workwarden, compat, bitwarden]
related:
  - ../docs/FEASIBILITY.md
  - ../docs/STACK.md
---

# Bitwarden CLI compatibility

[FEASIBILITY.md §2.2](../docs/FEASIBILITY.md) names "a published test suite
proving client compatibility" as one of three things nobody in this niche has
done. This is that suite. `bitwarden-crypto.mjs` reproduces Bitwarden's
client-side key derivation so an account can be created that a stock
`@bitwarden/cli` will accept.

Run against `wrangler dev --local-protocol https` — `bw` refuses plain HTTP. CI
runs it on every pull request against that PR's preview Worker.

## Status: a stock client works

`compat/run.sh` registers an account with real Bitwarden client crypto, then
drives `@bitwarden/cli` through login, create, sync, and read-back:

```
ok   registered compat-…@workwarden.invalid
ok   bw login
ok   bw create item
ok   bw sync
ok   decrypted the item the client wrote
PASS a stock Bitwarden client can use this server
```

The last line is the claim. It is worth exactly what the script asserts and no
more: one user, one login item, no organizations, no attachments, no 2FA.

## What it caught

Six protocol gaps, none of which a unit test could have found — unit tests
assert the shape *we* chose. Each was a `200` from the server followed by a
crash inside the client.

| Finding | How it surfaced |
|---|---|
| `bw` calls `POST /identity/accounts/prelogin/password`, not `/api/accounts/prelogin` | 404 |
| Newer clients need `UserDecryptionOptions.MasterPasswordUnlock` | `toWrappedAccountCryptographicState` of null |
| That block's key field is `MasterKeyEncryptedUserKey` | "does not contain a valid master key encrypted user key" |
| The token response needs `AccountKeys` — the password login strategy reads it with **no null check**, unlike the SSO one | `Cannot read properties of null` |
| `attachments` must be `null` or an array; the client sends `{}` on create and we echoed it back | `attachments.map is not a function` |
| `organizationUseTotp` deserialises into a non-optional `bool` in the client's Rust SDK | `invalid type: unit value, expected a boolean` |

The last two are the same underlying mistake: storing the client's request blob
verbatim and returning it, so the client's own request fields overrode what the
server should own. `SERVER_FIELDS` in `src/routes/ciphers.ts` now strips them and
`cipher_details` sets them.

**Omitting `signatureKeyPair` and `securityState` from `AccountKeys` declares a
V1 account.** The client rejects the response if exactly one of the two is
present, so they move together or not at all. V2 accounts are not implemented.

## Found end-to-end, not by any test

Driving the deployed preview turned up a bug no unit test could reach, because
it lives in Cloudflare's configuration rather than in this repo.

**Hyperdrive caches read queries by default.** Registration asks "does this user
exist?", gets an empty result, and Hyperdrive caches it. Login runs the identical
`select * from users where email = …` and is served the cached empty row — so a
freshly registered user gets `invalid_grant` until the TTL expires. Waiting it
out and retrying then succeeded, which is what identified it.

Fixed with `wrangler hyperdrive update <id> --caching-disabled`. Note the
setting is **not** in `wrangler.jsonc` — wrangler rejects a `caching` key there,
silently as a warning. `deploy.yml` asserts it before every deploy.

A vault cannot serve stale reads for a second reason: the same cache would keep
a revoked session or a rotated security stamp working after it should have
stopped.
