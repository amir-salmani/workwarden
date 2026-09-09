#!/usr/bin/env node
// Reproduces the two CPU measurements that decide whether workwarden fits the
// Cloudflare Workers *free* plan (10 ms CPU per request).
//
//   node bench/limits.mjs
//
// Caveat: measured on the local V8/OpenSSL build, not on workerd. Treat as an
// order-of-magnitude signal. Workers uses BoringSSL for the same primitives, so
// PBKDF2 should land within ~2x; JSON.stringify is the same V8 code path.

import { webcrypto } from 'node:crypto'

const { subtle } = webcrypto
const FREE_CPU_MS = 10

const ms = (t0, t1) => Number(t1 - t0) / 1e6
const verdict = (v) => (v <= FREE_CPU_MS ? 'fits' : 'OVER free-tier budget')

async function kdf() {
  console.log('\n== 1. Server-side password hash (PBKDF2-SHA256) ==')
  console.log('   Vaultwarden default `password_iterations` = 600_000\n')
  // The client sends a 44-char base64 masterPasswordHash; the server hashes it again.
  const clientHash = new TextEncoder().encode('A'.repeat(44))
  const salt = new TextEncoder().encode('user@example.com')
  const key = await subtle.importKey('raw', clientHash, 'PBKDF2', false, ['deriveBits'])

  for (const iterations of [1_000, 5_000, 10_000, 100_000, 200_000, 600_000]) {
    const t0 = process.hrtime.bigint()
    await subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256)
    const t1 = process.hrtime.bigint()
    const v = ms(t0, t1)
    console.log(
      `   ${String(iterations).padStart(7)} iters  ${v.toFixed(2).padStart(7)} ms   ${verdict(v)}`,
    )
  }
}

function mkCipher(i) {
  // Bitwarden EncString shape: "2.<iv>|<ciphertext>|<mac>" — opaque to the server.
  const enc = (n) => `2.dGhpc2lzYWZha2VpdgAAAAAA|${'A'.repeat(n)}|${'B'.repeat(44)}`
  return {
    Id: `11111111-2222-3333-4444-${String(i).padStart(12, '0')}`,
    OrganizationId: null,
    FolderId: null,
    Type: 1,
    Name: enc(40),
    Notes: enc(200),
    Login: {
      Username: enc(30),
      Password: enc(40),
      Totp: enc(50),
      Uris: [{ Uri: enc(60), Match: null }],
    },
    Fields: [{ Name: enc(20), Value: enc(60), Type: 0 }],
    Favorite: false,
    Reprompt: 0,
    CollectionIds: [],
    RevisionDate: '2026-08-30T12:00:00.000Z',
    Attachments: null,
    Object: 'cipherDetails',
  }
}

function sync() {
  console.log('\n== 2. GET /api/sync — serialize the whole vault ==\n')
  for (const n of [100, 500, 1_000, 2_000, 5_000]) {
    const payload = {
      Profile: {},
      Folders: [],
      Collections: [],
      Ciphers: Array.from({ length: n }, (_, i) => mkCipher(i)),
      Domains: {},
      Sends: [],
      Policies: [],
      Object: 'sync',
    }
    const t0 = process.hrtime.bigint()
    const s = JSON.stringify(payload)
    const t1 = process.hrtime.bigint()
    const v = ms(t0, t1)
    console.log(
      `   ${String(n).padStart(5)} ciphers  ${(s.length / 1048576).toFixed(2).padStart(6)} MiB  ` +
        `${v.toFixed(2).padStart(7)} ms   ${verdict(v)}`,
    )
  }
  console.log('\n   NB: serialization alone. Add D1 round-trip + row->object mapping on top.')
}

await kdf()
sync()
console.log(`\nFree-plan budget: ${FREE_CPU_MS} ms CPU per request.\n`)
