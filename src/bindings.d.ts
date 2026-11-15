// Secrets never appear in wrangler.jsonc, so `wrangler types` cannot generate
// them. Declared here instead, and merged into both the global Env and the
// Cloudflare.Env that `cloudflare:test` uses, so there is one source of truth.
type WorkwardenSecrets = {
  HYPERDRIVE: Hyperdrive

  AUTH_PEPPER: string
  JWT_SECRET: string
  // The one address allowed to register, once. Config, not a secret.
  OWNER_EMAIL: string
}

interface Env extends WorkwardenSecrets {}

declare namespace Cloudflare {
  interface Env extends WorkwardenSecrets {}
}
