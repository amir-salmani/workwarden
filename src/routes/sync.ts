import { Hono } from 'hono'
import type { App } from '../app.ts'
import { requireUser } from '../auth/session.ts'
import { profile } from './accounts.ts'

export const sync = new Hono<App>()

/**
 * The whole response is assembled by Postgres and cast to text, so the Worker
 * copies bytes and never parses or re-serialises the vault. That is the
 * cache-on-write inversion from STORAGE.md §2.2 in its simpler form: at 2,000
 * ciphers JSON.stringify alone cost 12 ms against a 10 ms budget, and this
 * moves that cost off the Worker entirely.
 */
sync.get('/', requireUser(), async (c) => {
  const user = c.get('user')
  const origin = new URL(c.req.url).origin
  const rows = await c.get('sql')<{ body: string }[]>`
    select json_build_object(
      'profile', ${c.get('sql').json(profile(user))}::jsonb,
      'folders', coalesce(
        (select jsonb_agg(json order by json->>'id') from folder_details where user_id = ${user.id}),
        '[]'::jsonb),
      'ciphers', coalesce(
        (select jsonb_agg(cipher_json(ch, ${origin}) order by ch.id)
           from ciphers ch where ch.user_id = ${user.id}),
        '[]'::jsonb),
      'collections', '[]'::jsonb,
      'domains', null,
      'policies', '[]'::jsonb,
      'sends', coalesce(
        (select jsonb_agg(sd.json order by sd.json->>'name')
           from send_details sd where sd.user_id = ${user.id}),
        '[]'::jsonb),
      'object', 'sync'
    )::text as body`
  return c.body(rows[0]?.body ?? '', 200, { 'content-type': 'application/json' })
})
