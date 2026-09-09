---
type: Decision Record
title: Where the workwarden vault lives
description: D1 or external Postgres — decided on the exit path, not on capacity.
status: settled
created: 2026-08-30
timestamp: 2026-08-30
tags: [workwarden, storage, d1, postgres, neon]
related:
  - FEASIBILITY.md
  - STACK.md
---

# Where the vault actually lives

Follow-on to [FEASIBILITY.md](FEASIBILITY.md). Question: should storage be
Cloudflare D1, or an external free Postgres?

Evidence date: 2026-08-30.

---

## Part 1 — Evidence

### 1.1 Free-tier budgets, side by side

| | **D1** | **External Postgres via Hyperdrive** |
|---|---|---|
| Cost unit | **rows** | **queries** |
| Reads | 5,000,000 rows / day | 100,000 queries / day |
| Writes | **100,000 rows / day** | (same 100,000 / day pool) |
| Storage | 5 GB | provider's limit |

Sources: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/).

The unit difference is the whole story. D1 charges per **row**; Hyperdrive
charges per **statement**. One `INSERT … VALUES` writing 50 rows costs 50
against D1's 100k/day, and 1 against Hyperdrive's 100k/day. D1 indexes
double-count: a write to an indexed column writes the table row *and* the index
row.

[Hyperdrive is on the Free plan](https://developers.cloudflare.com/changelog/post/2025-04-08-hyperdrive-free-plan/)
as of April 2025, and pools connections at the edge, removing "seven round-trips
… the TCP handshake (1x), TLS negotiation (3x), and database authentication
(3x)" ([docs](https://developers.cloudflare.com/hyperdrive/get-started/)).
Workers can also reach Postgres directly via
[`connect()`](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/),
but the docs explicitly steer to Hyperdrive instead.

### 1.2 Free Postgres providers

| Provider | Storage | Idle behaviour | Verdict |
|---|---|---|---|
| [Neon](https://neon.com/faqs/free-plan-limits-and-quotas) | 0.5 GB / project | scale-to-zero after **5 min**, auto-resumes | usable |
| [Supabase](https://supabase.com/docs/guides/platform/free-project-pausing) | 0.5 GB | **pauses after 7 days**, then eventually **deleted** | disqualified |
| Render | — | free Postgres expires | disqualified |

Neon free also caps **5 GB egress / month** and 100 CU-hours compute / project /
month. Supabase pausing is measured by API requests, not dashboard visits;
projects left paused are permanently removed.

### 1.3 Vault size in context

From `bench/limits.mjs`: 5,000 ciphers ≈ 6.91 MiB of JSON. Vault rows are small
text blobs. Neon's 0.5 GB is ~70× more than a large personal vault needs.
Storage is not the constraint on either option. Attachments are the exception,
and belong in R2 regardless.

### 1.4 What Postgres does *not* change

The two blockers measured in FEASIBILITY.md §1.2 are **CPU inside the Worker**,
and the 10 ms free-plan budget applies no matter where the bytes are stored:

- Login PBKDF2 at Vaultwarden's 600k default: 74 ms. Unchanged by storage choice.
- `/api/sync` serialization at 2,000 ciphers: 12 ms. Unchanged *by default* —
  but see §2.2.

Waiting on a database does not count toward CPU time
([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)),
so a slower database does not consume more of the 10 ms budget. It costs
wall-clock latency, not budget.

Unverified: whether TLS/connection setup inside `connect()` bills CPU to the
isolate. Hyperdrive makes it moot by pooling.

---

## Part 2 — Conclusions

### 2.1 The real reason to do this is not capacity. It is the exit.

FEASIBILITY.md §2.4 identified the sharpest risk: an Iranian-operated Cloudflare
account can be suspended by Trust & Safety with no effective appeal. **On D1,
suspension takes the vault with it.** The data and the compute die together.

External Postgres decouples them. Suspension then costs the *compute* — a Worker
is redeployable on any platform in an hour — and the vault is untouched.

That is a stronger argument than any limit in §1.1, and it is the one that
decides it.

It does not *remove* the risk. Neon is also a US company under the same
sanctions regime, and signing up from Iran may itself be blocked. What it buys
is **decorrelation**: two independent providers must both fail to lose
everything, instead of one.

### 2.2 Postgres also offers a second route past the `/sync` blocker

FEASIBILITY.md §2.1 proposed cache-on-write. Postgres allows an alternative:
build the sync response **in the database** with `json_agg` / `json_build_object`
and stream the response body through the Worker without ever parsing it. The
serialization cost moves off the 10 ms budget entirely.

Cache-on-write is still faster — it skips the database round trip altogether —
but `json_agg` is far simpler and has no cache-invalidation bug class. Sensible
order: `json_agg` first, add the cache later if it is actually needed.

### 2.3 The costs, stated plainly

- **Cold starts.** Neon scales to zero after 5 minutes idle. A vault used a few
  times a day means most unlocks pay a resume (~hundreds of ms), then are warm.
  A Cron Trigger keep-alive ping fixes it and costs a few requests a day.
- **Egress.** Neon's 5 GB/month is a *new* limit D1 does not have. At 1.4 MiB per
  full sync that is ~3,500 syncs/month. Fine for a person or a family; the first
  thing to break if this is ever a public service. `json_agg` makes this worse,
  since the JSON crosses the wire; cache-on-write makes it better.
- **Latency.** Neon free is single-region; Workers are everywhere. Hyperdrive
  removes the handshake round trips but not the distance.
- **One more provider to trust**, one more account to keep alive, one more thing
  to back up.

### 2.4 Decision

**Neon Postgres behind Hyperdrive, with R2 for attachments.** Not for speed and
not for capacity — D1 is better on both. For the exit path in §2.1.

Non-negotiable regardless of choice: automated encrypted export in standard
Bitwarden JSON, landing somewhere neither Cloudflare nor Neon controls. Storage
choice changes which single failure is survivable; only an off-platform export
makes *both* survivable.
