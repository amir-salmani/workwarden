---
type: Guide
title: Phase 0 — measuring real CPU on workerd
description: How to get the numbers, and why the Worker cannot time itself.
status: open
created: 2026-09-10
timestamp: 2026-09-10
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

## What to record

Deploy, then drive each endpoint enough times to get a stable median.

| | Laptop (FEASIBILITY.md §1.2) | workerd | Verdict |
|---|---|---|---|
| `GET /api/config` | — | | baseline: framework + routing only |
| `POST /identity/connect/token`, 10k iterations | 1.49 ms | | |

The gap between the two rows is the KDF. If it lands near 1.5 ms, the peppered
10k design in [FEASIBILITY.md §2.1](FEASIBILITY.md) holds and Phase 1 can start.

## The other two questions Phase 0 settles

- **Does a Durable Object get more than 10 ms on the free plan?** Unresolved
  since [FEASIBILITY.md §1.1](FEASIBILITY.md); warden-worker's README claims the
  offload works and the Cloudflare docs do not say. Measure it, do not inherit
  the claim.
- **Do stock clients verify the identity token's signature?** Decides whether
  HS256 can stay instead of Vaultwarden's RS256
  ([STACK.md §6](STACK.md)).

## What Phase 0 is not

A stock Bitwarden client cannot log in against this. `/identity/connect/token`
returns a token but not the `Key`, `PrivateKey` or `Kdf` block a client needs to
decrypt anything — those need the database, which is Phase 1. There is one user,
configured through `SPIKE_EMAIL` and `SPIKE_AUTH_HASH`, and it goes away.
