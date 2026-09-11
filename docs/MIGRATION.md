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

Nothing has been migrated yet. Both routes below were rehearsed end to end on
2026-09-11 against real Bitwarden ciphertext.

## The one thing that does not transfer

Vaultwarden's `users.password_hash` is PBKDF2 at 600k iterations; workwarden's
is a peppered 10k hash ([FEASIBILITY.md §2.1](FEASIBILITY.md)). Neither converts
to the other — both take the *client-side* hash as input, and the server only
ever sees that at login. Verifying a Vaultwarden hash once in order to re-hash
it is not a way out either: 600k iterations costs 74 ms against a 10 ms budget
([PHASE0.md](PHASE0.md)).

Everything else transfers untouched, because everything else is ciphertext the
server cannot read anyway.

---

## Route A — move the database (whole server, all users)

`scripts/import-vaultwarden.mjs` reads Vaultwarden's SQLite file directly and
writes workwarden's schema. Vaultwarden splits a cipher across columns
(`name`, `notes`, `fields`, `data`, `password_history`); Bitwarden's wire format
is one object, and the importer rebuilds it.

Users arrive **claimable**: key material intact, `password_hash` null, one
single-use token each. A database constraint enforces that a row has exactly one
of a password hash or a claim token, so an account can never be both claimable
and loggable-into.

```sh
# On the Vaultwarden host: a consistent copy, not a file copy of a live database.
sqlite3 /path/to/db.sqlite3 ".backup '/tmp/vaultwarden-backup.sqlite3'"

# Then, wherever DATABASE_URL points at workwarden:
node scripts/import-vaultwarden.mjs /tmp/vaultwarden-backup.sqlite3
```

It prints one token per vault. Redeem each once — the owner does this, because
it needs the client-side hash of their master password:

```sh
node -e '
  const { makeAccount } = await import("./compat/bitwarden-crypto.mjs")
  const a = await makeAccount("you@example.com", "your master password")
  const r = await fetch("https://vault.amirsalmani.com/api/accounts/claim", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "you@example.com", token: "<token>",
                           masterPasswordHash: a.masterPasswordHash }),
  })
  console.log(r.status)
'
```

Then log in normally. The master password is unchanged, because the vault key
material came across with it.

Organization ciphers are **skipped, not flattened** into a personal vault —
that would change who can see them. Organizations are Phase 2.

---

## Route B — move it with a client (one vault, no server access)

No server access needed. Run from a machine that already has the vault
unlocked. **Do not give anyone else your master password**, including whoever is
helping you run this.

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

Route B re-encrypts every item under the new account's key, so the two vaults
share no key material afterwards. Route A keeps the original key material, so
the same master password keeps working and nothing is re-encrypted.

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
