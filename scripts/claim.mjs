// Redeem the one-time token an imported vault arrives with.
//
//   node scripts/claim.mjs you@example.com [--server https://vault.amirsalmani.com]
//
// Prompts for the master password, derives the client-side hash locally, and
// sends only that. The password never leaves this process, is never written
// anywhere, and is not echoed. See docs/MIGRATION.md.
import { makeAccount } from '../compat/bitwarden-crypto.mjs'

const email = process.argv[2]
const serverFlag = process.argv.indexOf('--server')
const server = serverFlag > -1 ? process.argv[serverFlag + 1] : 'https://vault.amirsalmani.com'
if (!email) throw new Error('usage: claim.mjs <email> [--server https://...]')

/**
 * Reading the two answers.
 *
 * Not readline: its `question()` buffers every line of a pipe before the second
 * call registers, and muting its echo by patching `_writeToOutput` leaks the
 * keystrokes anyway, because it re-renders the whole line including the prompt.
 * Raw mode is longer but it is honest about what reaches the terminal.
 */
function makeReader() {
  const stdin = process.stdin
  const wasRaw = stdin.isRaw
  stdin.setRawMode(true)
  stdin.resume()

  let pending = '' // input already received but not yet consumed by a prompt
  let waiting = null

  const deliver = () => {
    if (!waiting) return
    const i = pending.search(/[\r\n]/)
    if (i === -1) return
    const line = pending.slice(0, i)
    pending = pending.slice(i + 1).replace(/^\n/, '')
    const { resolve } = waiting
    waiting = null
    process.stdout.write('\n')
    resolve(line)
  }

  stdin.on('data', (chunk) => {
    for (const ch of chunk.toString('utf8')) {
      if (ch === '\u0003') {
        process.stdout.write('\n')
        process.exit(130)
      }
      if (ch === '\u007f' || ch === '\b') {
        if (pending.length > 0 && !/[\r\n]$/.test(pending)) {
          pending = pending.slice(0, -1)
          if (waiting && !waiting.secret) process.stdout.write('\b \b')
        }
        continue
      }
      // Only echo characters belonging to the line being asked for now. A
      // paste can carry the next answer in the same chunk, and echoing that
      // would print the master password.
      const lineAlreadyComplete = /[\r\n]/.test(pending)
      pending += ch
      if (waiting && !waiting.secret && !lineAlreadyComplete && !/[\r\n]/.test(ch)) {
        process.stdout.write(ch)
      }
    }
    deliver()
  })

  return {
    // Leftover input survives between prompts, so two lines arriving in one
    // chunk -- a paste, or any piped feed -- does not lose the second.
    ask(query, { secret }) {
      process.stdout.write(query)
      return new Promise((resolve) => {
        waiting = { resolve, secret }
        deliver()
      })
    },
    close() {
      stdin.setRawMode(wasRaw)
      stdin.pause()
    },
  }
}

async function prompts() {
  if (!process.stdin.isTTY) {
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(chunk)
    const [token = '', password = ''] = chunks.join('').split('\n')
    return { token, password }
  }
  const reader = makeReader()
  const token = await reader.ask('Claim token: ', { secret: false })
  const password = await reader.ask(`Master password for ${email}: `, { secret: true })
  reader.close()
  return { token, password }
}

const answers = await prompts()
const token = answers.token.trim()
const password = answers.password

if (!token || !password) throw new Error('both a token and a master password are required')

// The KDF parameters must match what the vault was encrypted with, or the
// derived hash belongs to a different key entirely.
const pre = await fetch(`${server}/identity/accounts/prelogin/password`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email }),
})
if (!pre.ok) throw new Error(`prelogin failed: ${pre.status}`)
const { kdfIterations } = await pre.json()

process.stdout.write(
  `Deriving key (${kdfIterations.toLocaleString()} iterations, a few seconds)... `,
)
const account = await makeAccount(email, password, kdfIterations)
process.stdout.write('done\n')

const res = await fetch(`${server}/api/accounts/claim`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, token, masterPasswordHash: account.masterPasswordHash }),
})

if (!res.ok) {
  console.error(`\nclaim failed: ${res.status} ${await res.text()}`)
  process.exit(1)
}
console.log(`\nClaimed. Now:\n  bw config server ${server}\n  bw login ${email}`)
