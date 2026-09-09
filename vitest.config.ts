import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
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
