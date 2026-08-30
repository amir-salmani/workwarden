# workwarden

A Bitwarden-client-compatible server on Cloudflare Workers, aimed at
`vault.amirsalmani.com`.

**Status: feasibility only. No server code yet.** Do not point a client at this.

Read [`docs/FEASIBILITY.md`](docs/FEASIBILITY.md) and [`docs/STORAGE.md`](docs/STORAGE.md) before writing any code — it
decides two design questions that are expensive to reverse later (server-side
KDF cost, and how `/sync` is served), and it documents that two mature projects
already occupy this niche.

## Reproduce the measurements

```
node bench/limits.mjs
```

Prints the CPU cost of the server-side password hash and of `/api/sync`
serialization against the 10 ms free-plan budget.

## Not yet decided

- Name — `-warden` is the ecosystem convention, but "workwarden" reads as *work*, not *worker*
- License — AGPLv3 (matches Vaultwarden) vs MIT
- Whether this is published publicly at all
