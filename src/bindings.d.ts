// Secrets never appear in wrangler.jsonc, so `wrangler types` cannot generate
// them. Declared here instead, and merged into both the global Env and the
// Cloudflare.Env that `cloudflare:test` uses, so there is one source of truth.
type WorkwardenSecrets = {
  HYPERDRIVE: Hyperdrive
  ATTACHMENTS: R2Bucket
  NOTIFICATIONS: DurableObjectNamespace<import('./notifications.ts').NotificationHub>
  THROTTLE: DurableObjectNamespace<import('./throttle-object.ts').Throttle>

  AUTH_PEPPER: string
  JWT_SECRET: string
  SIGNUP_ALLOWLIST: string
}

interface Env extends WorkwardenSecrets {}

declare namespace Cloudflare {
  interface Env extends WorkwardenSecrets {}
}
