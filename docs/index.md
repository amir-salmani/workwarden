---
type: Index
title: workwarden docs
description: Feasibility, storage, and stack — the decisions taken before any code.
status: active
created: 2026-09-10
timestamp: 2026-09-10
tags: [workwarden]
---

# workwarden — docs

Read in order. Each one answers a question the next one assumes.

- [FEASIBILITY.md](FEASIBILITY.md) — *Can this be built on the Workers free
  tier, and is the niche already taken?* Go, reframed: not a third "Vaultwarden
  on Workers" but the trustworthy one with organizations.
- [STORAGE.md](STORAGE.md) — *Where does the vault live?* Neon Postgres behind
  Hyperdrive. Decided on the exit path, not on capacity.
- [STACK.md](STACK.md) — *What is it built out of?* TypeScript, Hono, raw SQL.
  Draft until a Phase 0 spike ratifies it.

[generated/](generated/index.md) is regenerable from source and is not authored.

Phase 0 is scaffolded; nothing is deployed.
