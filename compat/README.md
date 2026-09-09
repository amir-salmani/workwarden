---
type: Evidence
title: Bitwarden CLI compatibility — findings
description: What driving a stock `bw` at workwarden has proved, and where it currently stops.
status: open
created: 2026-09-10
timestamp: 2026-09-10
tags: [workwarden, compat, bitwarden, phase1]
---

# Bitwarden CLI compatibility

[FEASIBILITY.md §2.2](../docs/FEASIBILITY.md) names "a published test suite
proving client compatibility" as one of three things nobody in this niche has
done. This is that suite. `bitwarden-crypto.mjs` reproduces Bitwarden's
client-side key derivation so an account can be created that a stock
`@bitwarden/cli` will accept.

Run against `wrangler dev --local-protocol https` — `bw` refuses plain HTTP.

## What it has already caught

Three gaps in one session, none of which the unit tests could have found,
because unit tests assert the shape *we* decided on.

| Finding | Status |
|---|---|
| `bw` calls `POST /identity/accounts/prelogin/password`, not `/api/accounts/prelogin` | fixed |
| Newer clients need `UserDecryptionOptions.MasterPasswordUnlock` to build their account crypto state | fixed |
| That block's key field is `MasterKeyEncryptedUserKey` | fixed |

## Where it stops, as of 2026-09-10

`bw login` gets `200` from `/identity/connect/token` and then fails in the
client:

```
TypeError: Cannot read properties of null (reading 'toWrappedAccountCryptographicState')
```

Server-side the flow is complete — `/api/config`,
`/identity/accounts/prelogin/password` and `/identity/connect/token` all answer
`200`. The failure is the CLI assembling its own crypto state from the response,
so at least one more field is missing or misnamed.

The 2026 clients model an account's keys as more than the user key: a public-key
encryption keypair, a signature keypair, and a security state. The likely next
step is an `AccountKeys` block alongside `MasterPasswordUnlock`. `[unverified]`

**This is not a claim that workwarden is client-compatible.** It is a claim that
the login handshake reaches the client's crypto layer. Until `bw sync` returns a
vault, the suite is a debugging harness, not a proof, and
[the README](../README.md) should not say otherwise.

## Not yet automated

Wiring this into `preview.yml` needs a deployed preview, which needs a Neon
database. Until then it runs by hand against local `wrangler dev`.
