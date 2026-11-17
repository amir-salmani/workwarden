---
type: Evidence
title: Bitwarden CLI compatibility — findings
description: What driving a stock `bw` at workwarden has proved, how to run it, and the protocol gaps only a real client could find.
status: settled
created: 2026-09-10
timestamp: 2026-11-17
tags: [workwarden, compat, bitwarden]
related:
  - ../docs/CLIENTS.md
  - ../docs/history/FEASIBILITY.md
---

# Bitwarden CLI compatibility

[FEASIBILITY.md §2.2](../docs/history/FEASIBILITY.md) names "a published test
suite proving client compatibility" as one of three things nobody in this niche
had done. This is that suite. `bitwarden-crypto.mjs` reproduces Bitwarden's
client-side key derivation so an account can be created that a stock
`@bitwarden/cli` will accept.

## Run it

`bw` refuses plain HTTP, so the dev server must speak TLS. Two terminals:

```
npx wrangler dev --local-protocol https --var OWNER_EMAIL:compat@workwarden.invalid
BASE=https://localhost:8787 compat/run.sh
```

The script resets the local D1 before and after. It is not in CI: it needs a
running server and a real `bw`. Run it before anything that touches the wire
format.

## Status: ten round-trips pass

Last run 2026-11-15, against D1, with `@bitwarden/cli` 2026.6:

```
ok   registered compat@workwarden.invalid
ok   bw login
ok   bw create item
ok   bw sync
ok   decrypted the item the client wrote
ok   bw create folder
ok   bw edit item: folder, password and history round-trip
ok   bw delete item (to trash)
ok   bw restore item
ok   bw delete folder: item survives, unfiled
PASS a stock Bitwarden client can use this server
```

The last line is the claim, and it is worth exactly what the script asserts:
one user, login items, folders, trash. The mobile apps and the extension were
verified by hand against the live vault; what they needed is in
[CLIENTS.md](../docs/CLIENTS.md).

## What it caught

Six protocol gaps, none of which a unit test could have found, because unit
tests assert the shape *we* chose. Each was a `200` from the server followed by
a crash inside the client.

| Finding | How it surfaced |
|---|---|
| `bw` calls `POST /identity/accounts/prelogin/password`, not `/api/accounts/prelogin` | 404 |
| Newer clients need `UserDecryptionOptions.MasterPasswordUnlock` | `toWrappedAccountCryptographicState` of null |
| That block's key field is `MasterKeyEncryptedUserKey` | "does not contain a valid master key encrypted user key" |
| The token response needs `AccountKeys`; the password login strategy reads it with **no null check**, unlike the SSO one | `Cannot read properties of null` |
| `attachments` must be `null` or an array; the client sends `{}` on create and we echoed it back | `attachments.map is not a function` |
| `organizationUseTotp` deserialises into a non-optional `bool` in the client's Rust SDK | `invalid type: unit value, expected a boolean` |

The last two are the same mistake: storing the client's request blob verbatim
and returning it, so the client's own fields overrode what the server owns.
`SERVER_FIELDS` in [`src/routes/ciphers.ts`](../src/routes/ciphers.ts) strips
them and the server sets them.

**Omitting `signatureKeyPair` and `securityState` from `AccountKeys` declares a
V1 account.** The client rejects the response if exactly one of the two is
present, so they move together or not at all. V2 accounts are not implemented.
