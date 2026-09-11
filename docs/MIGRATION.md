---
type: Guide
title: Moving a vault from Vaultwarden to workwarden
description: The rehearsed procedure, and the parts only the vault's owner can do.
status: open
created: 2026-09-11
timestamp: 2026-09-11
tags: [workwarden, migration, vaultwarden]
related:
  - BACKUP.md
  - FEASIBILITY.md
---

# Moving a vault from Vaultwarden

Nothing has been migrated yet. This is the rehearsed procedure, proven on
2026-09-11 between two unrelated accounts with different master passwords.

## Do not migrate by touching the database

Vaultwarden's `users.password_hash` is PBKDF2 at 600k iterations;
workwarden's is a peppered 10k hash ([FEASIBILITY.md §2.1](FEASIBILITY.md)).
Neither can be converted to the other — the input is the client-side hash, which
the server only ever sees at login. Copying rows produces an account nobody can
log into.

Verifying a Vaultwarden hash once, to re-hash it, is not a way out either: 600k
iterations costs 74 ms against a 10 ms budget ([PHASE0.md](PHASE0.md)).

The client moves the vault instead. It has the keys; the server never does.

## The procedure

Run from a machine that already has the vault unlocked. **Do not give anyone
else your master password**, including whoever is helping you run this.

```sh
# 1. Export from Vaultwarden, encrypted with a transfer passphrase.
#    Not --format json: that writes every password to disk in the clear.
bw config server https://vault.rhinocloud.ir
bw login
bw export --format encrypted_json --password '<transfer passphrase>' \
  --output /dev/shm/migration.json

# 2. Create the account on workwarden, from a client, with any master password.
bw config server https://vault.amirsalmani.com
bw login            # after registering

# 3. Import. It prompts for the transfer passphrase.
bw import bitwardenjson /dev/shm/migration.json

# 4. Destroy the transfer file.
shred -u /dev/shm/migration.json
```

`/dev/shm` is RAM, not disk. The file is ciphertext under the transfer
passphrase throughout, and the passphrase is independent of either account's
master password — which is what makes the export portable between accounts at
all.

## What this does and does not carry

| | |
|---|---|
| carried | login items, secure notes, cards, identities, folders, favourites |
| not carried | organizations and collections (not implemented — Phase 2), attachments (Phase 3), 2FA settings, sends, emergency access, password history |

Items are **re-encrypted under the new account's key** on import, so the two
vaults share no key material afterwards.

## Verify before trusting it

Count items on both sides and open two or three by hand:

```sh
bw list items | jq 'length'
```

[FEASIBILITY.md §2.4](FEASIBILITY.md) still stands: the existing Vaultwarden
remains the system of record until workwarden has earned the job over months.
Migrating is a copy, not a cutover. Do not decommission anything.
