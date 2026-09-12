---
type: Guide
title: Phase 0 — measuring real CPU on workerd
description: How to get the numbers, and why the Worker cannot time itself.
status: settled
created: 2026-09-10
timestamp: 2026-09-12
tags: [workwarden, phase0, cpu, observability]
related:
  - FEASIBILITY.md
  - STACK.md
---

# Phase 0 — measuring real CPU on workerd

Every CPU figure in [FEASIBILITY.md §1.2](FEASIBILITY.md) came off a laptop under
Node and OpenSSL. Phase 0 replaces them with numbers from `workerd` and
BoringSSL. Nothing downstream is worth building until it does.

## The Worker cannot time itself

The obvious approach — wrap the KDF in `performance.now()` — does not work, and
fails silently rather than erroring. From the
[Workers security model](https://developers.cloudflare.com/workers/reference/security-model/)
`[confirmed]`:

> `Date.now()` returns the time of the last I/O. It does not advance during code
> execution.

> the value returned by `Date.now()` is locked in place while code is executing.
> No other timers are provided.

That is a deliberate Spectre mitigation, not a bug. An in-Worker timer around
the KDF would return `0` and read as a pass.

## Where the number actually comes from

CPU time is published per invocation, outside the isolate
([changelog, 2025-04-09](https://developers.cloudflare.com/changelog/post/2025-04-09-workers-timing/))
`[confirmed]`. `wrangler.jsonc` enables invocation logs at full sampling for
this.

```
npx wrangler deploy
npx wrangler tail --format json          # cpuTime per invocation
```

Or the [Query Builder](https://dash.cloudflare.com/?to=/:account/workers-and-pages/observability/investigate)
for a median across many requests. Take the median, not one sample — the first
invocation includes isolate startup.

## Results, 2026-09-10

Deployed to `workwarden.<subdomain>.workers.dev` and driven with curl; cpuTime
read from `wrangler tail --format json`. Variants separated by a query string so
the tail event can tell them apart — a 400 response still has `outcome: "ok"`,
so outcome cannot.

| variant | n | p50 | p90 | max |
|---|---|---|---|---|
| `GET /api/config` | 30 | **0 ms** | 0–3 ms | 5 ms |
| token, unsupported grant — no KDF | 70 | **0 ms** | 4 ms | 20 ms |
| token, wrong password — KDF only | 70 | **3 ms** | 6 ms | 8 ms |
| token, success — KDF + JWT sign | 105 | **4 ms** | 7 ms | 10 ms |

Reading down the column isolates each cost:

- **Routing, form parsing, JSON: free.** Hono does not register.
- **Peppered 10k PBKDF2: +3 ms.**
- **HS256 sign: +1 ms.**

`cpuTime` is reported in whole milliseconds, so every figure carries ±0.5 ms of
quantization. The 20 ms outlier is a single no-KDF request — isolate startup, not
work. Every invocation returned `outcome: "ok"`; nothing was killed.

### The laptop was optimistic by about 2×

[FEASIBILITY.md §1.2](FEASIBILITY.md) measured 10k PBKDF2 at **1.49 ms** under
Node and OpenSSL. On workerd and BoringSSL it is **3 ms**.

The design holds — a 4 ms login against a 10 ms budget — but the headroom is
**2.5×, not the 6.7× the laptop implied**, and p90 is already 7 ms.

### What that implies for `/sync` (inference, not measurement)

If the same ~2× factor applies to `JSON.stringify`, the serialization figures in
[FEASIBILITY.md §1.2](FEASIBILITY.md) all double, and the point where `/sync`
exceeds budget moves from ~1,500 ciphers down to **~700**. That makes the
cache-on-write / `json_agg` inversion in [STORAGE.md §2.2](STORAGE.md) not an
optimization but a requirement, at a vault size a real person reaches.

Unverified — V8 is the same in both places, so the factor may not carry. Measure
it in Phase 1 rather than inheriting this number. `[unverified]`

## Still unmeasured

Neither of these was answered by this round. Both stay open.

- **Does a Durable Object get more than 10 ms on the free plan?** Unresolved
  since [FEASIBILITY.md §1.1](FEASIBILITY.md); warden-worker's README claims the
  offload works and the Cloudflare docs do not say. Needs a DO to exist first.
- **Do stock clients verify the identity token's signature?** Decides whether
  HS256 can stay instead of Vaultwarden's RS256 ([STACK.md §6](STACK.md)).
  Needs a client that can complete a login, so it lands in Phase 1.

## Production contradicts the 10 ms budget, 2026-09-12

Measured from invocation logs over 24 hours of real use, 2,334 requests:

| | |
|---|---|
| median CPU | 9 ms |
| p95 | 35 ms |
| max | 53 ms |
| outcomes | 2,295 `ok`, 2 `exception`, 5 `canceled`, 32 `responseStreamDisconnected` |
| **`exceededCpu`** | **0** |

The [Workers limits page](https://developers.cloudflare.com/workers/platform/limits/)
(read 2026-09-12) says 10 ms per HTTP request on the Free plan and 30 s by
default on Paid. A third of these requests are over 10 ms and **not one has been
killed for it**. `[reported]`

**The account is on the Free plan** (confirmed 2026-09-12), so the 10 ms figure
is the one that applies. Which leaves the measurement itself in question, and
the per-route breakdown says why:

| route | median | p95 | max | n |
|---|---|---|---|---|
| `POST /api/ciphers` | 18 | 43 | 52 | 222 |
| `POST /identity/connect/token` | 13 | 33 | 53 | 94 |
| `GET /api/sync` | 11 | 25 | 34 | 87 |
| `POST /identity/accounts/prelogin/password` | 3 | 19 | 19 | 13 |
| `GET /api/config` | 7 | 13 | 14 | 55 |

`GET /api/config` returns a fixed object and opens no connection. A handler that
does nothing cannot spend 7 ms of CPU, so `cpuTimeMs` is counting something
besides handler work — isolate startup being the obvious candidate. It also
explains why the routes sit within a few milliseconds of each other while all
reading above the limit.

So the alarming reading is probably the wrong one, and the KDF decision stands
until the metric is understood rather than because of it
([ROADMAP.md](ROADMAP.md) §1).

## What Phase 0 is not

A stock Bitwarden client cannot log in against this. `/identity/connect/token`
returns a token but not the `Key`, `PrivateKey` or `Kdf` block a client needs to
decrypt anything — those need the database, which is Phase 1. There is one user,
configured through `SPIKE_EMAIL` and `SPIKE_AUTH_HASH`, and it goes away.
