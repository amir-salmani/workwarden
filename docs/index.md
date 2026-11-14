---
type: Index
title: workwarden
description: A single-user, Bitwarden-client-compatible server on Cloudflare Workers. Frozen 2026-09-13 after its deploy workflow hijacked vault.amirsalmani.com; revived 2026-11-15 as the personal-vault successor to vaultwarden. Nothing deploys until that route is removed.
status: active
created: 2026-09-13
timestamp: 2026-11-15
tags: [tool, workwarden]
related:
  - ../README.md
project:
  id: workwarden
  owner: amir
  kind: tool
  lifecycle: active
  visibility: public
  hosting: none
  toolchain: node
---

# workwarden

A single-user, Bitwarden-client-compatible server on Cloudflare Workers.
Frozen 2026-09-13; revived 2026-11-15 to replace the self-hosted vaultwarden
for Amir's own vault. The repository is unarchived; the Workers stay deleted.

## Why it was frozen

Its `wrangler.jsonc` declares `{"pattern": "vault.amirsalmani.com",
"custom_domain": true}`, and `.github/workflows/deploy.yml` runs on push. On
2026-09-13 a documentation-only commit redeployed it and took the vault hostname
back from Vaultwarden.

Both Workers are deleted from Cloudflare. `vault.amirsalmani.com` is the live
vaultwarden until that vault is exported, backed up and deleted — nothing here
binds the name before then, and the first change on revival is defusing
`deploy.yml`.

The Neon database behind its Hyperdrive binding and the `workwarden-attachments`
R2 bucket still exist — data, not deployment, and yours to decide on.
