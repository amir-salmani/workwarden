---
type: Evidence
title: What each Bitwarden client needs from a server
description: Six things the 2026.10 clients require beyond the documented API, each found by one client failing after a 200, with the exact error and the commit that fixed it.
status: settled
created: 2026-11-17
timestamp: 2026-11-17
tags: [workwarden, compat, bitwarden, android, ios, extension, rbw]
related:
  - ../compat/README.md
  - ../README.md
  - generated/routes.md
---

# What each Bitwarden client needs from a server

Found on 2026-11-15 and 16, one client at a time, against a live vault. Every
row was a server response the client accepted with a 200 and then failed on.
The symptom column is the string to search for.

| Client | Symptom | What it needed | Fix |
|---|---|---|---|
| `bw` 2026.10 | `KDF config response does not contain a valid KDF type` | prelogin in the new shape, `kdfSettings {kdfType, iterations, memory, parallelism}` plus `salt` (the lowercased email), beside the old `kdf`/`kdfIterations` that 2026.6 still reads | `46acfc4` |
| `bw` 2026.10 | 404 after login, vault never unlocks | `POST /api/accounts/key-management/user-key-id`: the client backfills a user key id and expects the server to store it | `23bd807` |
| `rbw` 1.15 | `duplicate field `Key`` | the login response in **one** casing. The TypeScript clients read the top-level fields case-insensitively, so sending both `Key` and `key` is harmless to them and fatal to serde | `328155e` |
| Browser extension | unlock fails after login; the error names `publicKeyEncryptionKeyPair` | `AccountKeys.publicKeyEncryptionKeyPair {publicKey, wrappedPrivateKey}` read by direct property access, so camelCase, while the fields around it are PascalCase | `995379d` |
| Android, iOS | `This is not a recognised Bitwarden server` | `/api/config` must report a real server version; `0.0.0` is refused. Vaultwarden reports one for the same reason | `995379d` |
| Android | logs out after sync, `InvalidState(source=SetPasswordViewModel)` in the flight-recorder log | `UserDecryptionOptions` in camelCase inside (`hasMasterPassword`, `masterPasswordUnlock`, `userKeyId`), **and** the same `masterPasswordUnlock` block again under `userDecryption` in `/api/sync`. The app rebuilds "has a master password" from the sync copy; without it, it routes to set-password and signs out | `56e69b9`, `0e32872` |
| Android, iOS | repeated `knowndevice` and push-token calls, treated as a broken server when 404 | `GET /api/devices/knowndevice` answering truthfully; `PUT /api/devices/identifier/:id/token` and `clear-token` answering 200 with no push behind them; `POST /api/accounts/password-hint` answering 200 | `96832d9` |

## The casing rule, in one place

| Where | Casing | Read by |
|---|---|---|
| top level of the `/identity/connect/token` response (`Key`, `PrivateKey`, `Kdf`, `UserDecryptionOptions`, `AccountKeys`) | PascalCase, once | TypeScript clients case-insensitively; rbw exactly |
| inside `UserDecryptionOptions` and `AccountKeys` | camelCase | Android (kotlinx, case-sensitive) and the extension by property access |
| everything in `/api/sync` and `/api/accounts/prelogin` | camelCase | all |

[`src/routes/identity.ts`](../src/routes/identity.ts) and
[`src/auth/unlock.ts`](../src/auth/unlock.ts) carry the same notes next to the
code.

## How the Android one was found

The app shows a spinner, then the login screen, with nothing in the UI. Its
flight recorder (Settings → About → Flight recorder) writes a log that names the
view-model that gave up. Three logs, one per attempt, narrowed it from "login
fails" to "login succeeds, sync succeeds, the app then decides there is no master
password". The source of the Android app is public, and the view-model's name in
the log leads straight to the field it reads.

## Not needed

Signature verification of the access token: HS256 with a Worker secret is
accepted by every client above. A web vault. Push. The `/notifications` hub.
Anything under `/api/organizations`, `/api/sends`, `/api/emergency-access`.
