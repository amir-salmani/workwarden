---
type: Decision Record
title: The backup, and why restore is server-side
description: An automated encrypted export off Cloudflare and off Neon, and the client constraint that shapes it.
status: settled
created: 2026-09-11
timestamp: 2026-09-12
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

**What it does not carry**, as of 2026-09-12:

| | Lost if Neon and R2 both vanish | Why it is acceptable |
|---|---|---|
| Attachment **blobs** (R2) | yes — the item survives, the file does not | the only irreplaceable one; one file today |
| Sends | yes | they expire by design; a Send older than its deletion date is already gone |
| 2FA enrolment | yes | re-enrol from the authenticator app in a minute |
| Emergency-access grants | yes | re-invite; the grantee's own vault is untouched |

Trashed items *are* carried: they are ordinary rows with a deletion date.

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

## Part 5 — Leaving, for anywhere

The files in `vaults/` are Bitwarden-shaped, but every field inside them is
still ciphertext under the account key. **They cannot be imported into
1Password, Bitwarden cloud, or anything else directly.** Only a client holding
the master password can turn them back into readable items.

So the exit always has the same shape, whatever the destination and however many
years later:

1. stand a server up from a backup — workwarden, or the archived Vaultwarden
2. point a client at it
3. let the client export

```sh
bw config server <that server>
bw login you@example.com

bw export --format encrypted_json --password '<transfer passphrase>'  # Bitwarden, Vaultwarden
bw export --format json                                               # anything else, PLAINTEXT
```

`encrypted_json` with `--password` is keyed by the passphrase rather than the
account, which is what makes it portable between accounts and servers. Prefer
it.

Plaintext `json`/`csv` is what 1Password and KeePass actually accept. It is
every password you own, readable. Write it to `/dev/shm`, import, `shred -u`.

## Part 6 — Where the file goes

A private GitHub repository, `workwarden-backups`, written daily by
`.github/workflows/backup.yml`. One age-encrypted file per vault, named for the
vault and overwritten in place; git history is the versioning.

**A night that changed nothing writes nothing** (2026-09-12). The file used to
carry the date in its name, so an idle vault still produced a new one every
night — and age output differs on every run even for identical input, so nothing
deduplicated it: roughly 330 MB of repository history a year for a vault nobody
touched. `vaults/manifest.json` now records a SHA-256 of each export with its
timestamp removed, and a vault whose digest has not moved is not re-encrypted.
Growth follows what you actually change.

The files written before that date keep their dated names. Nothing here deletes
a backup, including one belonging to an account that no longer exists.

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
