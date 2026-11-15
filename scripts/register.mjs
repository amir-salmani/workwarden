// Register the one account. `bw` has no register command and there is no web
// vault, so this does what a client would: real Bitwarden crypto, and the
// master password never leaves this process.
//
//   BASE=https://workwarden.example.workers.dev node scripts/register.mjs you@example.com
import { execSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { makeAccount } from '../compat/bitwarden-crypto.mjs'

const base = process.env.BASE
const email = process.argv[2]
if (!base || !email) {
  console.error('usage: BASE=<server url> node scripts/register.mjs <email>')
  process.exit(2)
}

// Hidden input: turn the terminal's echo off around the question.
async function ask(prompt) {
  // terminal: false, or readline echoes the keystrokes itself regardless of stty.
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false })
  const tty = process.stdin.isTTY
  if (tty) execSync('stty -echo', { stdio: 'inherit' })
  try {
    return await rl.question(prompt)
  } finally {
    if (tty) execSync('stty echo', { stdio: 'inherit' })
    rl.close()
    process.stdout.write('\n')
  }
}

const password = await ask(`Master password for ${email}: `)
const again = await ask('Again: ')
if (password !== again || password.length < 12) {
  console.error('Passwords differ or are under 12 characters. Nothing was sent.')
  process.exit(1)
}

const account = await makeAccount(email, password)
let r
try {
  r = await fetch(`${base}/api/accounts/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(account),
  })
} catch (e) {
  console.error(`could not reach ${base}: ${e.cause?.message ?? e.message}`)
  process.exit(1)
}
if (!r.ok) {
  console.error(`register failed: ${r.status} ${await r.text()}`)
  process.exit(1)
}
console.log(`registered ${email} on ${base}`)
console.log(`next: npx bw config server ${base} && npx bw login ${email}`)
