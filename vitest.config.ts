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
          // Test-only keypair; the identity is in test/snapshot.test.ts.
          AGE_RECIPIENT: 'age1jy5g74gpl27uvu92h6cwedz59yum89ylld3fl0ltk23lj6p56ajs4k0v97',
          TEST_MIGRATIONS: migrations,
        },
      },
    }),
  ],
})
