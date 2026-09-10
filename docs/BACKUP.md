---
type: Decision Record
title: The backup, and why restore is server-side
description: An automated encrypted export off Cloudflare and off Neon, and the client constraint that shapes it.
status: settled
created: 2026-09-11
timestamp: 2026-09-11
tags: [workwarden, backup, export, restore]
related:
  - FEASIBILITY.md
  - STORAGE.md
  - STACK.md
---

# The backup

[FEASIBILITY.md §2.4](FEASIBILITY.md) makes this non-negotiable: an automated
encrypted export, in a standard format, landing somewhere neither Cloudflare nor
Neon controls. Not a database dump — a dump is restorable only into the thing it
came from, which is no exit at all.

---

## Part 1 — What is in the file

`vault_export` builds it, and every field in it is already ciphertext. The server
has never held a key that could decrypt a vault, so the export is zero-knowledge
by construction.

| | |
|---|---|
| `items`, `folders` | exactly Bitwarden's export shape |
| `workwarden.account` | the protected symmetric key, the RSA keypair, the KDF parameters, the server-side password hash and salt |

The account block is the difference between an export you can *read* and one you
can *restore*. Without it the ciphertext is unopenable by anyone, forever.

On top of that, [age](https://age-encryption.org) public-key encryption. CI holds
the **recipient**, never the identity — so a compromised workflow can write a
backup but cannot read one back.

## Part 2 — Restore is server-side, and that is not a shortcut

`bw import` of an account-encrypted export requires
`encKeyValidation_DO_NOT_EDIT`: a GUID encrypted **with the user's key**, which
the importer decrypts to confirm the key matches. Only a client can mint it.

**A server able to produce that field would be a server able to read your
vault.** The zero-knowledge property and client-importable server-side exports
are mutually exclusive; this design keeps the former.

So restore loads the export back into a Bitwarden-compatible server —
`scripts/restore-vault.mjs` — and the client then syncs as usual. The account
keeps its original id, so a client that had synced before sees the same vault
rather than a duplicate.

## Part 3 — The recovery kit is two things, not one

The backup file **is not sufficient on its own**.

1. the `.age` backup
2. the **`AUTH_PEPPER`** it was taken under

The stored password hash is peppered ([FEASIBILITY.md §2.1](FEASIBILITY.md)), so
restoring under a different pepper produces an account nobody can log into. The
vault data would still be intact and the master password would still decrypt it,
but authentication would have to be rebuilt by hand.

Back the pepper up separately, and not beside the backups.

## Part 4 — It is tested, not asserted

`compat/verify-backup.sh` runs the whole cycle against a throwaway database:
build a vault with a real client, export it, **delete every row**, restore from
the encrypted file alone, then log in with a *fresh* client and check the
passwords come back.

```
ok   built a vault with a real client
ok   exported and encrypted
ok   deleted the vault
ok   restored from the encrypted backup
ok   a fresh client decrypted the restored vault
PASS the backup restores a working vault
```

It runs on every pull request, against that PR's own Neon branch, with a keypair
generated and discarded inside the run.

## Part 5 — Where the file goes

A private GitHub repository, `workwarden-backups`, written daily by
`.github/workflows/backup.yml`. One age-encrypted file per vault; git history is
the versioning.

Chosen 2026-09-11 over Hetzner object storage, which would have been a genuinely
independent fourth provider but bills per bucket. GitHub is free and is neither
Cloudflare nor Neon, which is what §2.4 asks for.

**The cost of that choice, stated:** GitHub already holds the deploy token and
runs the deploys, so a GitHub account suspension takes the code and the backups
together — exactly the correlation [STORAGE.md §2.1](STORAGE.md) argues against
for D1. It is a weaker answer than a fourth provider. What keeps it acceptable is
that the backups are ciphertext under an identity GitHub has never seen, and that
`git clone` puts a full copy on any machine that asks. **Clone it somewhere
offline.** Until you have, this is one provider away from being the only copy.

The job holds the age *recipient* and a deploy key scoped write-only to the
backups repository. It can write a backup; it cannot read one back, and it cannot
touch anything else.
