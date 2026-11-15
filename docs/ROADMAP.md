---
type: Register
title: workwarden roadmap
description: What is open, who it waits on, and what would settle it. Updated as things close.
status: active
created: 2026-09-12
timestamp: 2026-11-15
tags: [workwarden, roadmap, open]
related:
  - ASSURANCE.md
  - BACKUP.md
  - PHASE0.md
---

# workwarden roadmap

## Now

1. **Cutover.** Export the owner's vault from Vaultwarden (`bw export` or the
   web vault, plain JSON), register the one account on workwarden, `bw import
   bitwardenjson`, verify item counts and a few decryptions from a second
   client. Then, and only then, retire Vaultwarden on rhinocloud-de-1 and bind
   `vault.amirsalmani.com` here.
2. **A home for the age identity.** The Worker encrypts snapshots to
   `workwarden-backup-age`; its private half must exist somewhere that is not
   this account and not the vault it restores. Paper is enough.
3. **Rate limit on login.** One Cloudflare WAF rule on
   `/identity/connect/token`, replacing the deleted throttle object.

## Next

- Re-enable GitHub Actions once a deploy token with narrow scope exists; until
  then deploys are from a laptop.
- A second snapshot destination off this Cloudflare account.

## Deliberately not doing

Organizations, Sends, attachments, emergency access, server-side 2FA, SSO,
email, a web vault, live push. [SHAVE.md](SHAVE.md).

## Closed

- 2026-11-15: Phase 0's two open questions — server-side KDF cost and `/sync`
  serialization — closed by [SHAVE.md](SHAVE.md).
- 2026-11-15: Neon and Hyperdrive retired; D1 holds the vault.
- 2026-09-13: Vaultwarden on rhinocloud-de-1 took `vault.amirsalmani.com`
  back; this project froze. Revived 2026-11-15 with no custom hostname.
