---
type: Register
title: workwarden roadmap
description: What is open, who it waits on, and what would settle it. Updated as things close.
status: active
created: 2026-09-12
timestamp: 2026-11-17
tags: [workwarden, roadmap, open]
related:
  - ASSURANCE.md
  - BACKUP.md
  - CLIENTS.md
---

# workwarden roadmap

## Now

1. **Rate limit on login.** One Cloudflare WAF rule on
   `/identity/connect/token`. The free plan allows one such rule.
2. **A second snapshot destination.** The nightly export sits in R2 on the
   account that runs the vault. One copy elsewhere, pulled rather than pushed,
   so the Worker keeps holding the recipient only.

## Next

- GitHub Actions stays off; deploys are from a laptop. Turn it back on only
  with a deploy token scoped to this Worker.
- `compatibility_date` is capped by the workerd that miniflare bundles; raise it
  when wrangler does.

## Deliberately not doing

Organizations, Sends, attachments, emergency access, server-side 2FA, SSO,
email, a web vault, live push, a second user. [SHAVE.md](SHAVE.md).

## Closed

- 2026-11-17: the backup identity has a home off the laptop and off the account.
- 2026-11-16: extension, iOS, Android, macOS, `bw` and `rbw` all verified on the
  live vault. What each needed is in [CLIENTS.md](CLIENTS.md).
- 2026-11-15: cutover. The owner's vault imported (319 items), Vaultwarden on
  rhinocloud-de-1 archived and retired, `vault.amirsalmani.com` bound here.
- 2026-11-15: Neon and Hyperdrive retired; D1 holds the vault. Phase 0's two
  open questions closed by [SHAVE.md](SHAVE.md).
- 2026-09-13: a documentation commit redeployed a config that re-bound the live
  hostname and took it from Vaultwarden; the project froze until the revival.
