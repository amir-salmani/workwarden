---
type: Decision Record
title: workwarden tech stack
description: What workwarden is built out of, and the four choices that were not obvious.
status: active
created: 2026-09-10
timestamp: 2026-09-12
tags: [workwarden, cloudflare, workers, stack]
related:
  - FEASIBILITY.md
  - STORAGE.md
  - PHASE0.md
---

# workwarden — tech stack

Follows [FEASIBILITY.md](FEASIBILITY.md) (go / no-go) and
[STORAGE.md](STORAGE.md) (where the vault lives). This one answers: what is it
built out of.

Phase 0 ratified the KDF choice on real workerd
([PHASE0.md](PHASE0.md), 2026-09-10). The two entries in §6 are still open.

---

## Part 1 — The stack

| Layer | Choice | Note |
|---|---|---|
| Runtime | Cloudflare Workers, ES modules | free plan, 10 ms CPU |
| Language | TypeScript, `strict` | not Rust/WASM — see §2.1 |
| HTTP | [Hono](https://hono.dev) | ~100+ Bitwarden routes need a real router |
| Database | Neon Postgres | [STORAGE.md §2.4](STORAGE.md) |
| DB access | Hyperdrive → [`postgres`](https://github.com/porsager/postgres.js) | wire protocol, not Neon's HTTP driver — §2.2 |
| Schema | plain `.sql`, applied by [dbmate](https://github.com/amacneil/dbmate) | no ORM — §2.3 |
| Crypto | WebCrypto (`crypto.subtle`) only | zero crypto dependencies |
| Tokens | [`jose`](https://github.com/panva/jose) | HS256, 1 ms — [PHASE0.md](PHASE0.md) |
| Blobs | R2 | attachments, Sends |
| Realtime | Durable Object, SQLite backend | `/notifications/hub`, SignalR + MessagePack |
| Email | **none** | no SMTP path on Workers, and nothing here needs one — §2.6 |
| Validation | [zod](https://zod.dev) | request bodies come from clients we do not control |
| Tests | [`@cloudflare/vitest-pool-workers`](https://developers.cloudflare.com/workers/testing/vitest-integration/) + `@bitwarden/cli` | runs in `workerd`, not Node — §2.4 |
| Lint / format | [Biome](https://biomejs.dev) | one binary, replaces ESLint + Prettier |
| CI/CD | GitHub Actions | §3 |
| Secrets | Worker secrets / Secrets Store | the pepper; the DB URL lives in Hyperdrive, never in the Worker |
| Signup | `SIGNUP_ALLOWLIST` | addresses or `@domain`; unset means nobody, so a missing value fails closed |
| Web vault | **not shipped** | §2.5 |

---

## Part 2 — The choices that were not obvious

### 2.1 TypeScript, not Rust

warden-worker is Rust ([FEASIBILITY.md §1.4](FEASIBILITY.md)). The decisive
factor is that the one measured blocker is PBKDF2, and on Workers `crypto.subtle`
is native BoringSSL — a WASM PBKDF2 is slower than the platform primitive, not
faster. Rust would buy nothing on the hot path and spend the 3 MB script budget.
Phase 0 measured it: the peppered 10k PBKDF2 costs 3 ms on workerd against
1.49 ms on the laptop ([PHASE0.md](PHASE0.md)). `[confirmed]`

### 2.2 Hyperdrive + wire protocol, not `@neondatabase/serverless`

Neon's HTTP driver is simpler and needs no Hyperdrive. It is also Neon-specific,
and would undo the single reason Neon was chosen: [STORAGE.md §2.1](STORAGE.md)
picked external Postgres for the **exit path**, not for speed. A Neon-only driver
puts the lock-in back. Standard wire protocol moves to any Postgres in an
afternoon.

Cost: `nodejs_compat` is required for postgres.js on Workers `[reported]`.

### 2.3 No ORM

Three reasons, in order:

1. The hot path is hand-written SQL. [STORAGE.md §2.2](STORAGE.md) builds the
   `/sync` response with `json_agg` / `json_build_object` so serialization never
   touches the 10 ms budget. No ORM expresses that well.
2. The schema is dictated by the Bitwarden API, not by us. There is no domain
   model to model.
3. Every dependency in a password manager is audit surface.

Types come from hand-written row interfaces plus a zod parse at the HTTP
boundary. That is the boundary that actually matters — the database is ours, the
request body is not.

### 2.4 The test suite is the differentiator, so it is stack, not tooling

[FEASIBILITY.md §2.2](FEASIBILITY.md) identified "nobody in this niche has
published a test suite proving client compatibility" as one of three unclaimed
slots. So the compat suite drives **the real Bitwarden CLI** (`@bitwarden/cli`)
against a deployed preview: log in, sync, create, edit, delete, re-sync. A stock
client passing in CI is the strongest evidence this project can produce, and it
is cheap — `bw` is an npm package.

`@cloudflare/vitest-pool-workers` covers the unit layer and runs inside
`workerd`. That matters here specifically: every CPU number in
[FEASIBILITY.md §1.2](FEASIBILITY.md) was measured on a laptop under Node, and
the whole go/no-go rests on them.

### 2.5 The web vault is not shipped

[FEASIBILITY.md §2.3](FEASIBILITY.md): whoever serves the web vault's JavaScript
can serve a version that exfiltrates the master password, silently. SRI pinning
mitigates it. Not serving it removes it.

Native clients and the browser extension ship their own code and are unaffected,
so the cost is real but bounded. It also keeps the licensing clean — Vaultwarden's
[vw_web_builds](https://github.com/vaultwarden/vw_web_builds) is GPLv3, and
keeping it out of the tree means there is no aggregation question to explain.

If it ever ships, it ships as a separate Worker in a separate repo, SRI-pinned,
under its own license.

### 2.6 No email at all

Workers have no SMTP path, and every Bitwarden feature that would need one is
either unused here or works without it: there is one account, so no invitations
and no verification; a forgotten master password is unrecoverable by design, so
no reset mail. What it does cost is stated in the README — an emergency-access
invite only reaches someone who already has an account on this server, and a
grantor is not told when recovery starts.

---

## Part 3 — CI/CD

GitHub Actions, three workflows:

| Workflow | Trigger | Does |
|---|---|---|
| `ci` | PR, push to `master` | Biome, `tsc --noEmit`, vitest-pool-workers, route-surface diff, schema drift, prod-dep audit |
| `preview` | PR opened/updated | `wrangler deploy` to a separate preview Worker, then the `bw` compat suite against it |
| `preview-cleanup` | PR closed | deletes that PR's preview Worker and Neon branch |
| `deploy` | `ci` completing green on `master` | `dbmate up` against production, then `wrangler deploy` |
| `backup` | nightly 03:17 UTC | age-encrypted vault export to the backups repo |
| `secrets` | manual | pushes Worker secrets from the local `.secrets` directory |

`deploy` waits on a `workflow_run` of `ci` and checks out that run's SHA, so a
red build cannot ship. Previews are a **separate Worker**, not a preview URL:
Cloudflare does not generate preview URLs for a Worker that implements a Durable
Object.

Supply chain, which matters more here than in a normal repo: every action pinned
to a full commit SHA, minimal `permissions:` per job, `npm ci` against a
committed lockfile, Dependabot on.

**Stated plainly, in the README:** the Cloudflare API token lives in GitHub
Secrets, so a GitHub compromise can deploy modified server code. That is the same
class of hole as §2.5 and it is not fully closable while CI deploys. Being the
project that says so is the point of
[FEASIBILITY.md §2.2](FEASIBILITY.md)'s "safe" slot.

---

## Part 4 — Umbrella from day zero

The umbrella rule is *build the safety net first, and prove it fails*. Applied
before there is code to protect:

- **Route-surface table generated from source**, committed, diffed in CI. At
  100+ Bitwarden routes, a silently dropped route is the failure mode that stays
  green. This net comes first.
- **The `bw` compat suite** is the behavioural net (§2.4).
- **`okf lint` and the route net as a pre-commit hook** — `.githooks/pre-commit`,
  enabled with `git config core.hooksPath .githooks`.
- One concern per file from the first commit. No `src/index.ts` that grows into
  a directory in disguise.

---

## Part 5 — Settled, 2026-09-10

- **Name: `workwarden`.** *worker* of Cloudflare, *warden* of Bitwarden. The
  ambiguity noted in [FEASIBILITY.md §1.5](FEASIBILITY.md) is accepted.
- **License: MIT.** Chosen for least friction: no copyleft obligation on anyone
  deploying or forking, compatible with everything, matches warden-worker.
  AGPLv3's only real benefit here is preventing a closed hosted fork, which is
  not a concern for a self-host-first tool.
  **Load-bearing condition:** clean-room. No Vaultwarden source, schema, or logic
  copied — Vaultwarden is AGPLv3, and copying makes workwarden AGPLv3 whatever
  the LICENSE file says. Implement against the Bitwarden API surface and observed
  client behaviour.
- **Published publicly**, as open source.
- **`vault.amirsalmani.com` is the product**, not a demo.

## Part 6 — Closed, 2026-09-12

- **Token signing algorithm: HS256.** Stock clients treat the identity token as
  opaque — desktop, browser extension and CLI all log in, sync and edit against
  HS256 tokens in production. `[confirmed]`
- **DO CPU budget on the free plan.** Two Durable Object classes run there
  (`NotificationHub`, `Throttle`) and the free plan admits them. Per-request DO
  CPU is still unmeasured; nothing observed has come near the budget, which is
  weaker evidence than a number. `[reported]`
- **Export destination: a private GitHub repository**, age-encrypted, tracked
  here as the `backups/` submodule and written nightly by the `backup` workflow
  ([BACKUP.md](BACKUP.md)). CI holds the age *recipient* only, so the pipeline
  that writes the backups cannot read them. `[confirmed]`

### A conflict worth naming

"`vault.amirsalmani.com` is the product" and
[FEASIBILITY.md §2.4](FEASIBILITY.md)'s "the existing Vaultwarden instance stays
the system of record until workwarden has proven itself over months" are not the
same date. Pointing the domain at workwarden early is fine. A real vault living there is
not, until the off-Cloudflare export exists.

**Resolved 2026-09-12 by moving the export first.** The vault was cut over on
2026-09-11 with the nightly encrypted export already running and a verified,
bootable Vaultwarden restore bundle in the backups repo — so "proven over months"
was traded for "restorable in an hour", deliberately, and the old instance was
kept running through the comparison rather than trusted to memory.
