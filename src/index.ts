import app from './app.ts'
import { snapshot } from './snapshot.ts'

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(snapshot(env))
  },
} satisfies ExportedHandler<Env>
