import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Every test file shares one Postgres, and resetDatabase() truncates it, so
  // running files in parallel lets one wipe another's rows mid-test. Revisit
  // with a schema per worker if the suite gets slow.
  test: { fileParallelism: false },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        r2Buckets: ['ATTACHMENTS'],
        hyperdrives: {
          HYPERDRIVE: 'postgresql://postgres:dev@127.0.0.1:5432/workwarden',
        },
        bindings: {
          AUTH_PEPPER: 'test-pepper',
          JWT_SECRET: 'test-secret',
        },
      },
    }),
  ],
})
