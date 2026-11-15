/// <reference types="@cloudflare/vitest-pool-workers/types" />

// The migrations the test pool applies before each file; see vitest.config.ts.
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: D1Migration[]
  }
}
