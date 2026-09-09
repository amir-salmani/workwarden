import { expect, it } from 'vitest'
import { constantTimeEquals, deriveAuthHash } from '../src/auth/kdf.ts'

it('is deterministic for the same inputs', async () => {
  const a = await deriveAuthHash('client-hash', 'user@example.com', 'pepper')
  const b = await deriveAuthHash('client-hash', 'user@example.com', 'pepper')
  expect(a).toBe(b)
})

it('changes when the pepper changes', async () => {
  const a = await deriveAuthHash('client-hash', 'user@example.com', 'pepper')
  const b = await deriveAuthHash('client-hash', 'user@example.com', 'other-pepper')
  expect(a).not.toBe(b)
})

it('changes when the salt changes', async () => {
  const a = await deriveAuthHash('client-hash', 'user@example.com', 'pepper')
  const b = await deriveAuthHash('client-hash', 'other@example.com', 'pepper')
  expect(a).not.toBe(b)
})

it('compares equal and unequal strings', () => {
  expect(constantTimeEquals('abc', 'abc')).toBe(true)
  expect(constantTimeEquals('abc', 'abd')).toBe(false)
  expect(constantTimeEquals('abc', 'abcd')).toBe(false)
})
