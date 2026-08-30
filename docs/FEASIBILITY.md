# workwarden — feasibility

Target: a Bitwarden-client-compatible server on Cloudflare Workers free tier,
serving `vault.amirsalmani.com`.

Status: **pre-decision.** No server code written yet. This document is the
evidence base for a go / no-go / reframe call.

Date of evidence: 2026-08-30.

---

## Part 1 — Evidence

Facts and measurements only. Conclusions are in Part 2, so each claim below can
be checked against its source rather than trusted.

### 1.1 Free-plan platform limits

| Resource | Workers Free | Source |
|---|---|---|
| CPU time / HTTP request | **10 ms** | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Requests | 100,000 / day | ditto |
| Memory | 128 MB | ditto |
| External subrequests / invocation | 50 | ditto |
| Worker script size | 3 MB | ditto |
| Static asset files / version | 20,000 (25 MiB each) | ditto |
| D1 rows read | 5,000,000 / day | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| D1 rows written | **100,000 / day** | ditto |
| D1 storage | 5 GB total | ditto |
| Durable Objects requests | 100,000 / day | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| DO duration | 13,000 GB-s / day | ditto |
| DO SQLite storage | 5 GB total | ditto |
| DO on free plan | SQLite backend **only** | ditto |
| WebSockets / DO | 32,768 max | [DO state API](https://developers.cloudflare.com/durable-objects/api/state/) |

Notes carried from the docs:

- CPU time excludes time waiting on `fetch()`, KV, D1. Only compute counts.
- Docs explicitly suggest "offload work → move expensive computation to Durable
  Objects" as a CPU remedy. **Whether a DO gets a CPU budget above 10 ms on the
  free plan is not stated anywhere I could find. Unverified — must be measured.**
- Static assets are served free and unlimited, and do not count toward the 3 MB
  script size. The web vault bundle is therefore not a size problem.

### 1.2 Measured CPU costs

Reproduce with `node bench/limits.mjs`. Measured on this laptop (Node 24,
OpenSSL), not on `workerd` — same V8 for `JSON.stringify`, BoringSSL vs OpenSSL
for PBKDF2. Order-of-magnitude signal, not a production figure.

**Server-side password hashing.** Vaultwarden's `password_iterations` default is
`600_000` ([config.rs](https://github.com/dani-garcia/vaultwarden/blob/main/src/config.rs)).

| PBKDF2-SHA256 iterations | measured | vs 10 ms budget |
|---|---|---|
| 5,000 | 0.94 ms | fits |
| 10,000 | 1.49 ms | fits |
| 100,000 | 12.76 ms | over |
| 600,000 (Vaultwarden default) | **74.31 ms** | **7.4× over** |

**`GET /api/sync`** — Bitwarden clients pull the entire vault in one response.

| ciphers | payload | serialize only | vs 10 ms budget |
|---|---|---|---|
| 500 | 0.69 MiB | 4.58 ms | fits |
| 1,000 | 1.38 MiB | 8.21 ms | marginal |
| 2,000 | 2.76 MiB | 12.09 ms | over |
| 5,000 | 6.91 MiB | 21.38 ms | over |

Serialization alone; D1 round-trip and row→object mapping add more.

### 1.3 What server-side iterations actually buy

Palant, [*Bitwarden design flaw: server side iterations*](https://palant.info/2023/01/23/bitwarden-design-flaw-server-side-iterations/):

> "the 100,000 PBKDF2 iterations on the server side are only applied to the
> master password hash, not to the encryption key."

> "Testing the guesses against the master password hash would be fairly slow […]
> But the attackers wouldn't waste time doing that of course."

An attacker holding a stolen database attacks the vault ciphertext directly,
where only the **client-side** KDF (600k iterations, client-controlled) applies.
The server-side iteration count is bypassed entirely in that scenario.

### 1.4 Prior art — this space is occupied

| Project | Stack | Stars / forks | License | Gaps |
|---|---|---|---|---|
| [NodeWarden](https://github.com/shuaiplus/nodewarden) | TS, Workers + D1 + R2/KV | **3.5k / 3.9k** | LGPL-3.0 | no organizations, collections, RBAC, SSO/SCIM, emergency access |
| [warden-worker](https://github.com/qaz741wsd856/warden-worker) | **Rust**, Workers + D1 + KV/R2 + DO | 1.3k / 697 | MIT | no sharing, 2FA login, emergency access, organizations, admin |

NodeWarden already ships: web vault, 2FA (TOTP/YubiKey/passkey), passkey login,
API keys, recovery codes, real-time sync, attachments, import/export, device
management, login requests, multi-user, PWA/offline, WebDAV/S3 backup.

Its own README disclaims it as "for learning and discussion purposes only."

warden-worker's README states free-tier CPU constraints are "mitigated via
Durable Objects offloading" — which is the unverified claim in §1.1.

**Neither implements organizations / collections / sharing.** That is the same
hole in both, and it is the feature that makes Vaultwarden useful to a household
or team rather than one person.

### 1.5 Licensing and naming

- Vaultwarden is **AGPLv3** ([relicense discussion](https://github.com/dani-garcia/vaultwarden/discussions/2450)).
  A clean-room reimplementation of the *API* is not a derivative work; copying
  Vaultwarden source, schema, or logic into workwarden makes it AGPLv3.
- The web vault is a **fork of Bitwarden's GPLv3 client code**
  ([vw_web_builds](https://github.com/vaultwarden/vw_web_builds)); Vaultwarden
  deliberately uses only the GPLv3-licensed portions, not `bitwarden_license/`.
- `bitwarden_rs` was **renamed to Vaultwarden specifically over trademark/brand
  concerns** ([rename discussion](https://github.com/dani-garcia/vaultwarden/discussions/1642)).
  The `-warden` suffix is the convention the ecosystem settled on to stay clear
  of the Bitwarden mark. "workwarden" follows that convention, but reads as
  "work" (corporate/enterprise) rather than "worker", which is the actual pun.

### 1.6 Deployment target

`amirsalmani.com` is already on Cloudflare — NS `mario.ns.cloudflare.com` /
`sharon.ns.cloudflare.com`, resolving to `2a06:98c1:3120::3` (Workers/Pages
range). `vault.amirsalmani.com` does not resolve yet. No DNS obstacle.

### 1.7 Sanctions exposure

Cloudflare's [Self-Serve Subscription Agreement](https://www.cloudflare.com/terms/)
bars use by parties subject to US sanctions. Reports of Iranian accounts being
suspended by Trust & Safety exist
([community thread, Jan 2026](https://community.cloudflare.com/t/request-for-account-review-critical-internet-access-in-iran/884455)),
with support unable to intervene. Cloudflare has separately
[acknowledged potential sanctions-compliance problems](https://www.counterextremism.com/blog/cloudflare-admits-potential-sanctions-violations),
and [told CNN](https://www.cnn.com/2023/01/19/tech/cloudflare-white-house-iran-censorship-bypass/index.html)
that sanctions blocked it from acting on a White House request re: Iran.

This is a **platform-risk fact about the account**, independent of the code.

---

## Part 2 — Conclusions

### 2.1 Is it technically possible? Yes, with two forced design changes.

Both hard blockers are in §1.2, and both have clean fixes.

**Blocker A — login costs 74 ms, budget is 10 ms.**

Fix: drop server-side iterations to ~10,000 (1.5 ms) and add a **secret pepper**
— `PBKDF2(clientHash, salt, 10_000)` then `HMAC-SHA256(pepper, …)`, with the
pepper in Secrets Store, never in D1.

This is not a security regression, and §1.3 is why: server-side iterations are
already bypassed by anyone who steals the database, because they attack vault
ciphertext instead. The 600k iterations that matter are client-side and stay
untouched — the protocol is unchanged, so stock Bitwarden clients cannot tell.
The pepper is a strict *improvement* over Vaultwarden here: a D1 dump alone
becomes useless against the auth hash, where a Vaultwarden SQLite dump is not.

The claimed "offload to a Durable Object" workaround (§1.1, §1.4) should be
measured, but this design does not depend on it.

**Blocker B — `/sync` exceeds 10 ms at ~1,500 ciphers.**

Fix: **never serialize on read.** Keep a pre-rendered sync response per user in
KV or R2, rebuilt on write, and stream the bytes. Streaming a cached blob costs
almost no CPU, so vault size stops mattering — a 5,000-cipher vault becomes an
object read, not a 21 ms serialize.

This is also the honest answer to "extraordinarily fast": it is not fast because
it is Rust or because it is serverless — the *cache-on-write, stream-on-read*
inversion is the whole trick, and it is a genuine advantage over Vaultwarden,
which rebuilds this JSON on every sync.

Costs to accept: write amplification on every cipher edit, and a rebuild path
that must be exactly consistent with the D1 truth or clients silently desync.

**Non-blockers.** Web vault fits (static assets are free and uncapped). Icons,
mobile push relay, and HIBP are plain `fetch()` — but the 50-subrequest free cap
is real. WebSockets for `/notifications/hub` map onto a DO with hibernation
(32,768 sockets); note the protocol is **SignalR + MessagePack**
([Bitwarden docs](https://contributing.bitwarden.com/architecture/deep-dives/push-notifications/non-mobile/)),
which is a genuine implementation cost, not a websocket echo server. Email has no
SMTP path on Workers — use Cloudflare Email Sending or a REST provider.

**The real free-tier ceiling is D1 writes: 100,000 rows/day, account-wide.**
Not CPU, not storage. Indexes double-count writes. For one person or a family,
irrelevant. As a public service, this is what fails first.

### 2.2 Is it an open-source phenomenon? No — that slot is taken.

This is the finding worth pausing on. **NodeWarden has 3.5k stars and 3.9k
forks** and already ships nearly everything on the obvious roadmap. Building
"Vaultwarden on Workers" in 2026 means arriving third to a solved problem, and
the outcome is very likely a repo with 40 stars, not a phenomenon.

Two of the three adjectives are already commodity: *free* and *fast* are what
the platform gives everyone. Shipping them again is not a project.

**What is actually unclaimed:**

1. **Organizations, collections, sharing.** Missing from *both* incumbents
   (§1.4). It is the hardest part of the Bitwarden data model and the reason
   people keep a real Vaultwarden. This is a moat, not a checkbox.
2. **"Safe" as the differentiator.** Both incumbents are hobby-grade;
   NodeWarden's own README says "learning and discussion purposes only." Nobody
   in this niche has done a documented threat model, a reproducible build, a
   published test suite proving client compatibility, or a security audit.
   For a password manager that is the *only* adjective that ultimately matters.
3. **The trust problem nobody has honestly addressed** — see 2.3.

That reframes the pitch from "Vaultwarden on Workers" (done, twice) to "the one
you would actually trust with a real vault." Slower to build, and the only
version of this that could become a phenomenon.

### 2.3 The security angle that must be stated plainly

Vaultwarden's entire reason for existing is *not trusting a third party with
your vault*. Deploying to Workers hands the data and the execution environment
back to a third party. The zero-knowledge model mostly saves it — Cloudflare
sees only ciphertext, since the master key never leaves the client.

But there is one hole, and it is not theoretical: **if you serve the web vault
from the same Worker, whoever controls that deployment can serve modified
JavaScript that exfiltrates the master password.** Cloudflare, or anyone who
compromises the account or API token, can do this silently. Vaultwarden on a box
you own has the same shape of risk; the difference is who holds the key.

Mitigations that actually work, in order: prefer native clients and the browser
extension (they ship their own code and are not affected); if the web vault is
served at all, pin it with Subresource Integrity and publish the hashes; keep
deploys behind a hardware key. This belongs in the README as a stated limitation,
not buried. Being the project that says this out loud is itself the "safe"
differentiator from §2.2.

### 2.4 The risk that is not technical

Per §1.7, an Iranian-operated Cloudflare account carries a real, non-zero risk
of Trust & Safety suspension, with no effective appeal. For a password manager
this is a **data-availability risk, not just a downtime risk** — if the account
goes, D1 goes with it.

This does not argue against building it. It argues that the design must treat
Cloudflare as untrusted infrastructure that may vanish without notice:

- Automated encrypted export to somewhere outside Cloudflare, from day one, in
  the standard Bitwarden JSON format — not a D1 dump.
- Never make this the only copy of your vault. The existing Vaultwarden at
  `vault.rhinocloud.ir` stays the system of record until workwarden has proven
  itself over months.
- Consider whether a project intended as a public phenomenon should be published
  under a hosting account with this exposure.

### 2.5 Recommendation

Build it — but as **the trustworthy one with organizations**, not as a third
"Vaultwarden on Workers." The technical path is clear and both hard blockers
have real fixes. The strategic risk (§2.2) is much larger than the technical one.

Sequence, gated so each phase can kill the project cheaply:

- **Phase 0 — spike, ~1 day.** Deploy a Worker that answers
  `/api/config` + `/identity/connect/token` with the peppered 10k KDF, and log
  real CPU. Confirms §1.2 on `workerd` rather than on this laptop, and settles
  the DO-CPU question in §1.1. Everything downstream depends on these numbers.
- **Phase 1 — single-user core.** `/sync` with cache-on-write, ciphers, folders,
  devices. Prove a stock Bitwarden client can log in, sync, and edit.
- **Phase 2 — the differentiators.** Organizations + collections + sharing;
  automated off-Cloudflare export; documented threat model; a client-compat test
  suite that runs in CI.
- **Phase 3 — the rest.** 2FA, sends, attachments, emergency access, push.

Open decisions before Phase 0 is worth starting: the name (§1.5 — "workwarden"
reads as *work*, not *worker*), the license (AGPLv3 to match Vaultwarden, or MIT
to match warden-worker), and whether this is published publicly at all given §2.4.
