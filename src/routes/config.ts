import { Hono } from 'hono'
import type { App } from '../app.ts'

export const config = new Hono<App>()

config.get('/config', (c) => {
  const origin = new URL(c.req.url).origin
  // `version` is the official server version this one behaves like. The
  // mobile apps compare it against a minimum and refuse "0.0.0" with "This is
  // not a recognised Bitwarden server" -- Vaultwarden reports one for the same
  // reason.
  return c.json({
    version: '2026.10.1',
    gitHash: null,
    server: { name: 'workwarden', url: 'https://github.com/amir-salmani/workwarden' },
    settings: { disableUserRegistration: true },
    environment: {
      vault: origin,
      api: `${origin}/api`,
      identity: `${origin}/identity`,
      notifications: `${origin}/notifications`,
      sso: '',
    },
    featureStates: {},
    object: 'config',
  })
})
