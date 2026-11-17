---
type: Decision Record
title: The backup, and why restore is server-side
description: A nightly age-encrypted export from the Worker to R2, the recipient-only rule, and the restore that needs the same pepper.
status: settled
created: 2026-09-11
timestamp: 2026-11-17
tags: [workwarden, backup, export, restore]
related:
  - SHAVE.md
  - history/BACKUP-github.md
  - ../scripts/restore.mjs
---

# The backup

Every night at 03:17 UTC a cron trigger runs `snapshot()` in
[`src/snapshot.ts`](../src/snapshot.ts). For each user it builds an export,
encrypts it to `AGE_RECIPIENT`, and writes two R2 objects:
`<user-id>/<YYYY-MM-DD>.json.age` and `<user-id>/latest.json.age`. First run
2026-11-17: 319 items, 91 folders, 623 KB.

## What is in the file

Bitwarden's export shape, plus one block that makes it restorable rather than
merely readable:

| Key | Holds |
|---|---|
| `encrypted: true` | every item field is ciphertext under the account key, as the client sent it |
| `folders`, `items` | exactly what `bw export --format encrypted_json` would hold |
| `workwarden.account` | the user row: email, KDF settings, the wrapped account key, the public/private keypair, and the server-side password verifier |

The server has never held a key that could decrypt an item, so the export is
zero-knowledge by construction; the age layer protects the account block and
the metadata, not the secrets.

## Recipient on the Worker, identity off it

The Worker holds the age *recipient* (a public key, in `wrangler.jsonc` as
config). It can write a backup it cannot read. The *identity* lives somewhere
that is neither the Worker, nor this Cloudflare account, nor the vault the
backup restores. If the identity's only copy is an item in the vault, the
backup is unreadable on exactly the day it is needed.

## Restore

```
node scripts/restore.mjs latest.json.age <identity-file> --remote
```

Decrypts, turns the export into SQL, applies it with `wrangler d1 execute` into
an **empty** database. Two things carry over and one does not:

- The password verifier carries over, so the Worker must run with the same
  `AUTH_PEPPER` the export was taken under. Keep the pepper with the identity.
- The item and folder ids carry over, so clients that synced before see the same
  vault.
- The security stamp is fresh, so every old session is dead; clients log in
  again.

Then log in with the master password. Nothing else is needed.

## Leaving, for anywhere

The items cannot be imported into 1Password, Bitwarden cloud or anything else
directly: they are ciphertext under the account key, and no other service holds
that key. The exit is always the same three steps: restore into any workwarden
(a free Cloudflare account is enough), log in with the master password from a
client, export plaintext from that client. Write it to `/dev/shm`, import where
you are going, `shred -u`.

## What this replaced

The first build pushed the export from GitHub Actions to a private repository
and skipped nights that changed nothing
([history/BACKUP-github.md](history/BACKUP-github.md)). Writing from the Worker
removes the deploy token, the second repository and the workflow. The cost is
that the snapshots sit on the same Cloudflare account as the vault; a second
destination is on the [roadmap](ROADMAP.md).
