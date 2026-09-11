---
type: Decision Record
title: Assurance — what Bitwarden and Vaultwarden have, and what this can have
description: Features are cheap to copy; assurance is not. What the incumbents actually hold, and which parts of it a one-person project can reach.
status: settled
created: 2026-09-12
timestamp: 2026-09-12
tags: [workwarden, security, audit, assurance]
related:
  - FEASIBILITY.md
  - STACK.md
---

# Assurance

The question this answers: *"features aren't what makes a password manager
trustworthy — assurance is. Do Bitwarden and Vaultwarden have it, and if they
do, why can't we?"*

Short answer: **yes, both have it, and in different amounts.** Most of what they
hold is reachable here and some of it is already done. One part is not, and
saying which is the honest version of the answer.

---

## Part 1 — Evidence

### 1.1 Bitwarden

Audited every year by named firms, with the reports published
([bitwarden.com/help/is-bitwarden-audited](https://bitwarden.com/help/is-bitwarden-audited/),
read 2026-09-12) [confirmed]:

- **2025** — Cure53, Unit 42, Fracture Labs, ETH Zurich: browser extension and
  autofill, core application, desktop, the RustCrypto crate, web vault,
  cryptography, mobile, network.
- **2024** — IOActive, Paragon Initiative, Mandiant, Fracture Labs, Cure53.
- **2023, 2022, 2021, 2020, 2018** — Cure53 and Insight Risk Consulting.

Also **ISO 27001**, **SOC 2 Type 2** and **SOC 3**, GDPR, CCPA, HIPAA with an
annual third-party audit, and a bug bounty on HackerOne.

### 1.2 Vaultwarden

Not a company, and audited anyway — twice, by third parties, in 2024
([dani-garcia/vaultwarden wiki: Audits](https://github.com/dani-garcia/vaultwarden/wiki/Audits))
[confirmed]:

- **June 2024, BSI "CAOS"** — the German federal security agency funded a static
  and dynamic analysis of the server, carried out with mgm security partners. It
  found **two vulnerabilities with raised hazard potential** plus further
  security-relevant problems; reports are published in German and English
  ([mgm-sp.com](https://www.mgm-sp.com/en/blog-and-news/security-of-vaultwarden-and-keepass-analyzed-for-the-bsi/),
  [heise](https://www.heise.de/en/news/Password-manager-BSI-reports-critical-vulnerabilities-in-Vaultwarden-9982432.html)).
- **October 2024, ERNW** — a penetration test run for a customer found three
  issues including an **authentication bypass**, CVE-2024-55225, fixed in
  1.32.5 in November 2024
  ([insinuator.net](https://insinuator.net/2024/11/vulnerability-disclosure-authentication-bypass-in-vaultwarden-versions-1-32-5/)).

Note what that second one means. Vaultwarden had been running in production for
years, in thousands of installations, before a paid outside reader found a way
past its authentication. **Assurance is not a property of careful code. It is a
property of having been attacked by someone who was paid to succeed.**

### 1.3 What this project holds today

| | Bitwarden | Vaultwarden | workwarden |
|---|---|---|---|
| Source public | yes | yes | yes |
| Reproducible from source | yes | yes | yes |
| Automated tests, public | yes | yes | 105, run in `workerd` |
| CI gate before deploy | yes | yes | yes — `deploy` waits on green `ci` |
| Client-compat test suite | internal | no | `compat/` drives real crypto |
| Third-party audit | annual, many firms | 2× in 2024 | **none** |
| Bug bounty | HackerOne | no | no |
| Certifications | ISO 27001, SOC 2/3 | none | none |
| Independent users to find bugs | millions | thousands | **one** |

---

## Part 2 — Conclusions

### 2.1 Four of the five things are already here or are cheap

Public source, reproducible builds, a real test suite, and a CI gate are
engineering discipline, not budget. They are done.

The client-compatibility harness in `compat/` is arguably something neither
incumbent publishes: it drives the actual Bitwarden crypto against this server
and checks the bytes, so a protocol regression fails the build rather than a
vault.

### 2.2 The fifth is not reachable, and pretending otherwise is the failure mode

A third-party audit costs money this project does not have, and **no amount of
care substitutes for it** — §1.2 is the proof, on a codebase far more reviewed
than this one. The same goes for exposure: Vaultwarden's bugs are found because
thousands of people run it. One user finds one user's worth of bugs.

So the honest claim is not "as safe as Vaultwarden." It is:

> Same crypto, same protocol, less assurance. Audited by nobody, attacked by
> nobody, and run by its author.

That is already what `README.md` says, and it stays.

### 2.3 What follows from that

1. **Keep the blast radius small.** Personal use, one account, no multi-tenancy
   — stated in the README, not merely intended. A bug here loses one vault.
2. **Keep the exit open.** Encrypted exports off-platform in standard Bitwarden
   JSON ([BACKUP.md](BACKUP.md), [MIGRATION.md](MIGRATION.md)), plus a bootable
   Vaultwarden restore bundle. Assurance you cannot buy, you substitute with
   recoverability: the question stops being *will it fail* and becomes *what
   does failing cost*.
3. **Never market it.** The moment someone else's vault is here, the missing
   audit becomes their problem and they did not get to read this page.
4. **Invite the attack that is free.** Public source and a written threat model
   are the only parts of §1.2 that cost nothing.

### 2.4 Decision

Ship the features; claim only the assurance that exists. The gap in §2.2 is
permanent for a project of this size, and the correct response to a permanent
gap is disclosure, not compensation.
