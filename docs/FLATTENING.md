---
type: Decision Record
title: Organizations removed, flattened into folders
description: Why a single-user vault drops sharing, and the order the change has to happen in.
status: settled
created: 2026-09-12
timestamp: 2026-09-12
tags: [workwarden, organizations, folders, migration]
related:
  - MIGRATION.md
  - BACKUP.md
---

# Organizations removed

## Verdict

This vault has one user. Organizations bought nothing and cost an entire second
key hierarchy: an org symmetric key wrapped per member, collections, memberships,
per-collection permissions, and a visibility rule that has to be right or it
leaks a colleague's credentials. Folders do the same organising job for one
person with none of that.

Shared items become personal items in a folder named after the organization.

## The constraint that dictates the order

An organization's ciphers are encrypted with the **organization's** key; a
personal cipher with the **account** key. Moving one means re-encrypting it, and
the server holds neither key. Only a client can do this.

So the change is two steps, and the order is not negotiable:

1. **`scripts/flatten-orgs.mjs`** — run against a logged-in `bw`. It copies each
   shared item into a personal folder, re-encrypted, and reads the copy back
   before counting it. It never deletes: Bitwarden clients refuse to delete an
   organization's ciphers on the owner's behalf, and the server route for it
   only touches personal items.
2. **`20260912000011_drop_organizations.sql`** — drops the tables, and with them
   every original.

Running step 2 first destroys the data. There is no recovery inside the
database; only [the backup](BACKUP.md) would have it.

## What is lost

- **Sharing.** No organizations, no collections, no members. Reversing this
  means restoring from backup and re-migrating, not running the down migration,
  which restores the shape and not the rows.
- **Multi-collection items.** An item can sit in many collections but only one
  folder. Items in more than one keep the alphabetically first; the tool names
  them before it does anything.

## Folder naming

`--collections` nests as `Organization/Collection`, which keeps both levels;
Bitwarden renders a `/` in a folder name as a tree. Without the flag the folder
is the organization name alone and collection membership is dropped.

## Tested

Proven against a synthetic vault with real Bitwarden crypto: two organizations,
three collections, six shared items. Every original ended with an identical
personal copy — same name, same password, correct folder — and the run is
resumable, skipping items already copied.

**Then run for real on 2026-09-11.** The production vault holds 0 organizations;
every original was matched to a copy by full content, not by name, and 29 TOTP
secrets came across intact. One bug only that check could find: two items sharing
a name in one trash, where a single copy satisfied both. Copies are now claimed
one per original.
