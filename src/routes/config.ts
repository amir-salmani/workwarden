import { Hono } from 'hono'
import type { App } from '../app.ts'

export const config = new Hono<App>()

config.get('/config', (c) => {
  const origin = new URL(c.req.url).origin
  return c.json({
    version: '0.0.0',
    gitHash: null,
    server: { name: 'workwarden', url: 'https://github.com/Amir-Salmani/workwarden' },
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
