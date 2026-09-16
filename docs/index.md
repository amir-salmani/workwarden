---
type: Index
title: workwarden
description: A Bitwarden-compatible server on Cloudflare Workers. Retired 2026-09-13. The Worker and its preview are deleted from Cloudflare and the repository is archived, because its deploy workflow re-binds vault.amirsalmani.com and hijacked the live vault once.
status: active
created: 2026-09-13
timestamp: 2026-09-13
tags: [tool, workwarden]
related:
  - ../README.md
project:
  id: workwarden
  owner: amir
  kind: tool
  lifecycle: frozen
  flow: trunk
  visibility: public
  hosting: none
  toolchain: node
---

# workwarden

A Bitwarden-compatible server on Cloudflare Workers. Retired 2026-09-13. The Worker and its preview are deleted from Cloudflare and the repository is archived, because its deploy workflow re-binds vault.amirsalmani.com and hijacked the live vault once.

## Why this is frozen and not merely dormant

Its `wrangler.jsonc` declares `{"pattern": "vault.amirsalmani.com",
"custom_domain": true}`, and `.github/workflows/deploy.yml` runs on push. On
2026-09-13 a documentation-only commit redeployed it and took the vault hostname
back from Vaultwarden.

Both Workers are deleted from Cloudflare and the GitHub repository is archived.
Reviving this project means removing that route first.

The Neon database behind its Hyperdrive binding and the `workwarden-attachments`
R2 bucket still exist — data, not deployment, and yours to decide on.
