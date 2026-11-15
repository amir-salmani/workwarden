---
type: Index
title: workwarden
description: A single-user, Bitwarden-client-compatible server on Cloudflare Workers — one Worker, D1, R2, free plan. Revived 2026-11-15 to replace the self-hosted Vaultwarden for Amir's own vault; serving on workers.dev until cutover.
status: active
created: 2026-09-13
timestamp: 2026-11-15
tags: [tool, workwarden]
related:
  - ../README.md
  - SHAVE.md
  - BACKUP.md
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
only UI. Deployed at `workwarden.cfworkerofabrinocloud.workers.dev` since
2026-11-15 with an empty database; the owner's account is created at cutover.

- [SHAVE.md](SHAVE.md) — the 2026-11-15 shape: what was cut, D1, the two
  decisions that make the free plan fit, the deploy rule.
- [BACKUP.md](BACKUP.md) — the nightly age-encrypted export and the restore.
- [ROADMAP.md](ROADMAP.md) — cutover, the age identity's home, login rate limit.
- [ASSURANCE.md](ASSURANCE.md) — no audit, and what is done instead.
- [generated/routes.md](generated/routes.md) — the 28 routes, read off the app.

History, kept: [FEASIBILITY.md](FEASIBILITY.md), [PHASE0.md](PHASE0.md),
[STACK.md](STACK.md), [STORAGE.md](STORAGE.md) (superseded),
[FLATTENING.md](FLATTENING.md), [MIGRATION.md](MIGRATION.md) (superseded).

## Why it was frozen

On 2026-09-13 a documentation-only commit redeployed a `wrangler.jsonc` that
declared `vault.amirsalmani.com` as a custom domain, and took the hostname from
the live Vaultwarden. The name is no longer in any file here; `workers.dev`
until cutover.
