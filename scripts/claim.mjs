// Redeem the one-time token an imported vault arrives with.
//
//   node scripts/claim.mjs you@example.com [--server https://vault.amirsalmani.com]
//
// Prompts for the master password, derives the client-side hash locally, and
// sends only that. The password itself never leaves this process, is never
// written anywhere, and is not echoed. See docs/MIGRATION.md.
import { createInterface } from 'node:readline'
import { makeAccount } from '../compat/bitwarden-crypto.mjs'

const email = process.argv[2]
const serverFlag = process.argv.indexOf('--server')
const server = serverFlag > -1 ? process.argv[serverFlag + 1] : 'https://vault.amirsalmani.com'
if (!email) throw new Error('usage: claim.mjs <email> [--server https://...]')

const ask = (prompt, hidden = false) =>
  new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    if (hidden) {
      rl.output.write(prompt)
      rl._writeToOutput = () => {}
      rl.question('', (a) => {
        rl.output.write('\n')
        rl.close()
        resolve(a)
      })
    } else {
      rl.question(prompt, (a) => {
        rl.close()
        resolve(a)
      })
    }
  })

const token = (await ask('Claim token: ')).trim()
const password = await ask(`Master password for ${email}: `, true)
if (!token || !password) throw new Error('both a token and a master password are required')

// The prelogin KDF parameters have to match what the vault was encrypted with,
// or the derived hash is for a different key entirely.
const pre = await fetch(`${server}/identity/accounts/prelogin/password`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email }),
})
const { kdfIterations } = await pre.json()

const account = await makeAccount(email, password, kdfIterations)
const res = await fetch(`${server}/api/accounts/claim`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, token, masterPasswordHash: account.masterPasswordHash }),
})

if (!res.ok) {
  console.error(`claim failed: ${res.status} ${await res.text()}`)
  process.exit(1)
}
console.log(`\nClaimed. Log in with:\n  bw config server ${server}\n  bw login ${email}`)
