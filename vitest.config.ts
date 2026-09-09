import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        hyperdrives: {
          HYPERDRIVE: 'postgresql://postgres:dev@127.0.0.1:5432/workwarden',
        },
        bindings: {
          AUTH_PEPPER: 'test-pepper',
          JWT_SECRET: 'test-secret',
          SPIKE_EMAIL: 'spike@example.com',
          SPIKE_AUTH_HASH: '',
        },
      },
    }),
  ],
})
