// Secrets never appear in wrangler.jsonc, so `wrangler types` cannot generate
// them. Declared here instead, and merged into both the global Env and the
// Cloudflare.Env that `cloudflare:test` uses, so there is one source of truth.
type WorkwardenSecrets = {
  AUTH_PEPPER: string
  JWT_SECRET: string

  // Phase 0 spike only -- one user, no database. Removed in Phase 1.
  SPIKE_EMAIL?: string
  SPIKE_AUTH_HASH?: string
}

interface Env extends WorkwardenSecrets {}

declare namespace Cloudflare {
  interface Env extends WorkwardenSecrets {}
}
