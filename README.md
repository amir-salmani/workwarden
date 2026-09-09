# workwarden

A Bitwarden-client-compatible server on Cloudflare Workers — *worker* of
Cloudflare, *warden* of Bitwarden. Serving `vault.amirsalmani.com`.

**Status: design only. No server code yet.** Do not point a client at this.

## Read first

[`docs/`](docs/index.md) holds the decisions taken before any code:
[feasibility](docs/FEASIBILITY.md), [storage](docs/STORAGE.md),
[stack](docs/STACK.md). Two of them are expensive to reverse later — the
server-side KDF cost, and how `/sync` is served.

The short version: two mature projects already do "Vaultwarden on Workers."
Neither implements organizations, collections, or sharing, and neither has a
published threat model or a client-compatibility test suite. That gap is the
project.

## Reproduce the measurements

```
node bench/limits.mjs
```

Prints the CPU cost of the server-side password hash and of `/api/sync`
serialization against the 10 ms free-plan budget.

## Stated limitations

A password manager should say these out loud rather than bury them.

- **Cloudflare can read what it executes.** The zero-knowledge model means it
  sees ciphertext only — but whoever controls the deployment controls the code.
  The web vault is deliberately not shipped for this reason
  ([STACK.md §2.5](docs/STACK.md)); use native clients and the browser extension,
  which ship their own code.
- **CI can deploy modified server code.** The Cloudflare API token lives in
  GitHub Secrets. Not fully closable while CI deploys.
- **The hosting account carries sanctions risk.**
  [FEASIBILITY.md §1.7](docs/FEASIBILITY.md). Storage lives outside Cloudflare so
  a suspension costs the compute, not the vault — but never make this the only
  copy.

## License

MIT — see [LICENSE](LICENSE). Clean-room: no Vaultwarden source, schema, or logic
is copied. Vaultwarden is AGPLv3, and copying would make this AGPLv3 regardless
of what the LICENSE file says.
