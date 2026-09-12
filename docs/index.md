---
type: Index
title: workwarden docs
description: Feasibility, storage, and stack — the decisions taken before any code.
status: active
created: 2026-09-10
timestamp: 2026-09-12
tags: [workwarden]
---

# workwarden — docs

**Personal use only.** Everything here describes one person's vault. Nothing in
this repository is offered as a service or as advice for running someone else's
credentials.

[ROADMAP.md](ROADMAP.md) is the live one: what is open, what it waits on, and
what was decided against. Everything below is the record behind it.

Read in order. Each one answers a question the next one assumes.

- [FEASIBILITY.md](FEASIBILITY.md) — *Can this be built on the Workers free
  tier, and is the niche already taken?* Go, reframed: not a third "Vaultwarden
  on Workers" but the trustworthy one. (Its organizations answer was later
  reversed — see FLATTENING.md.)
- [STORAGE.md](STORAGE.md) — *Where does the vault live?* Neon Postgres behind
  Hyperdrive. Decided on the exit path, not on capacity.
- [STACK.md](STACK.md) — *What is it built out of?* TypeScript, Hono, raw SQL.
  Ratified by Phase 0; its open questions closed on 2026-09-12.
- [BACKUP.md](BACKUP.md) — *What happens when Cloudflare or Neon vanishes?* An
  age-encrypted Bitwarden-format export, restorable, and tested by destroying a
  vault on every pull request.
- [FLATTENING.md](FLATTENING.md) — *Why are there no organizations?* One user
  does not need a second key hierarchy; shared items became folders.
- [MIGRATION.md](MIGRATION.md) — *How does an existing Vaultwarden vault get
  here?* Through a client, never the database — the password hashes are not
  convertible.
- [ASSURANCE.md](ASSURANCE.md) — *Bitwarden and Vaultwarden are audited; why
  isn't this?* Four of the five things that make a password manager trustworthy
  are here. The fifth costs money, and is disclosed rather than compensated for.
- [PHASE0.md](PHASE0.md) — *How do we get real CPU numbers?* Not from inside the
  Worker: workerd freezes the clock during execution.

[../compat/README.md](../compat/README.md) is the other half of the evidence:
what driving a stock `bw` client at this server has actually proved, and the six
protocol bugs it caught that no unit test reached.

[generated/](generated/index.md) is regenerable from source and is not authored.

Live at `vault.amirsalmani.com` since 2026-09-11. Feature parity with the
Vaultwarden it replaced, minus organizations, which were deliberately flattened
away.
