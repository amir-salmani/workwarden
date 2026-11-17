---
type: Index
title: History
description: The design records from the first build (August–September 2026), kept because the reasoning still explains the shape. Superseded where marked; nothing here is a guide to the current code.
status: active
created: 2026-11-17
timestamp: 2026-11-17
tags: [workwarden, history]
related:
  - ../index.md
  - ../SHAVE.md
---

# History

Design records from the first build, kept for the reasoning. The current shape is
[SHAVE.md](../SHAVE.md); where a record below disagrees with it, SHAVE wins.

| Record | What it settled | Still true? |
|---|---|---|
| [FEASIBILITY.md](FEASIBILITY.md) | A Bitwarden-compatible server fits the Workers free tier; nobody in the niche had published a client compatibility suite | yes, except the storage section |
| [PHASE0.md](PHASE0.md) | How to measure real CPU on workerd; the 3 ms auth-hash figure | yes |
| [STACK.md](STACK.md) | Hono, jose, zod, Biome, vitest-pool-workers | yes; the Postgres, Hyperdrive and Durable Object rows are gone |
| [STORAGE.md](STORAGE.md) | External Postgres for the exit path | superseded: D1, with the nightly export as the exit path |
| [FLATTENING.md](FLATTENING.md) | Organizations removed, flattened into folders | yes |
| [MIGRATION.md](MIGRATION.md) | A server-side claim flow from Vaultwarden | superseded: the cutover was a client-side `bw import` |
| [BACKUP-github.md](BACKUP-github.md) | Nightly export to a private GitHub repository from Actions | superseded: a cron trigger in the Worker writes to R2 |
