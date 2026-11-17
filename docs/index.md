---
type: Index
title: workwarden
description: A single-user, Bitwarden-client-compatible server on Cloudflare Workers — one Worker, D1, R2, free plan. Serves vault.amirsalmani.com since 2026-11-15; extension, iOS, Android, macOS, bw and rbw verified against it.
status: active
created: 2026-09-13
timestamp: 2026-11-17
tags: [tool, workwarden]
related:
  - ../README.md
  - SHAVE.md
  - BACKUP.md
  - CLIENTS.md
  - ROADMAP.md
project:
  id: workwarden
  owner: amir
  kind: tool
  lifecycle: active
  visibility: public
  hosting: cloudflare
  toolchain: node
---

# workwarden

A single-user, Bitwarden-client-compatible server on Cloudflare Workers: one
Worker, one D1 database, one R2 bucket, free plan. The Bitwarden clients are the
only UI. It has served `vault.amirsalmani.com` since 2026-11-15 with the owner's
319-item vault, and every stock client has been verified against it.

- [SHAVE.md](SHAVE.md) — the shape: what was cut, D1, the two decisions that
  make the free plan fit, the deploy rule.
- [CLIENTS.md](CLIENTS.md) — what each Bitwarden client needs from a server,
  found one client at a time.
- [BACKUP.md](BACKUP.md) — the nightly age-encrypted export to R2 and the restore.
- [ASSURANCE.md](ASSURANCE.md) — no audit, and what is done instead.
- [ROADMAP.md](ROADMAP.md) — open: login rate limit, second snapshot destination.
- [generated/routes.md](generated/routes.md) — the 34 routes, read off the app.
- [history/](history/index.md) — the first build's design records, kept for the
  reasoning.

The README at the root is the guide for running a copy; this directory is the
record of why it is shaped the way it is.
