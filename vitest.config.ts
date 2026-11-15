import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

const migrations = await readD1Migrations('db/migrations')

export default defineConfig({
  // Every test file shares one D1, and resetDatabase() empties it, so running
  // files in parallel lets one wipe another's rows mid-test.
  test: { fileParallelism: false, setupFiles: ['./test/apply-migrations.ts'] },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          AUTH_PEPPER: 'test-pepper',
          JWT_SECRET: 'test-secret',
          OWNER_EMAIL: 'alice@example.com',
          TEST_MIGRATIONS: migrations,
        },
      },
    }),
  ],
})
