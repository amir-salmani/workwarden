// Bitwarden's client-side key derivation, reproduced so the test suite can
// create an account that a stock `bw` can log into. This is the client half of
// the protocol; the server never sees any of it except the final hash and the
// already-encrypted key blobs.
//
// Reference: https://bitwarden.com/help/bitwarden-security-white-paper/
import { webcrypto as crypto } from 'node:crypto'

const utf8 = new TextEncoder()
const b64 = (buf) => Buffer.from(buf).toString('base64')

async function pbkdf2(password, salt, iterations, bytes = 32) {
  const key = await crypto.subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      key,
      bytes * 8,
    ),
  )
}

// Bitwarden expands an already-derived master key rather than running a full
// HKDF, so this is HKDF-Expand with a single 32-byte output block.
async function hkdfExpand(prk, info) {
  const key = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  const input = new Uint8Array([...utf8.encode(info), 1])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, input))
}

/** EncString type 2: AES-256-CBC with an HMAC-SHA256 tag. */
async function encrypt(plaintext, encKey, macKey) {
  const iv = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', encKey, 'AES-CBC', false, ['encrypt'])
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, plaintext))

  const hmacKey = await crypto.subtle.importKey(
    'raw',
    macKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', hmacKey, new Uint8Array([...iv, ...ct])),
  )
  return `2.${b64(iv)}|${b64(ct)}|${b64(mac)}`
}

export async function makeAccount(email, password, iterations = 600_000) {
  const lower = email.toLowerCase()

  const masterKey = await pbkdf2(utf8.encode(password), utf8.encode(lower), iterations)
  const masterPasswordHash = b64(await pbkdf2(masterKey, utf8.encode(password), 1))

  const stretchedEnc = await hkdfExpand(masterKey, 'enc')
  const stretchedMac = await hkdfExpand(masterKey, 'mac')

  // The vault's actual symmetric key: 32 bytes of AES key plus 32 of MAC key.
  const symmetric = crypto.getRandomValues(new Uint8Array(64))
  const protectedKey = await encrypt(symmetric, stretchedEnc, stretchedMac)

  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-1',
    },
    true,
    ['encrypt', 'decrypt'],
  )
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))
  const encryptedPrivateKey = await encrypt(pkcs8, symmetric.slice(0, 32), symmetric.slice(32))

  return {
    email: lower,
    masterPasswordHash,
    kdf: 0,
    kdfIterations: iterations,
    key: protectedKey,
    keys: { publicKey: b64(spki), encryptedPrivateKey },
  }
}
