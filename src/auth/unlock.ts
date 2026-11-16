import type { User } from '../users.ts'

/**
 * What a client needs to turn the master password into the user key: the KDF
 * parameters, the salt (the lowercased email) and the wrapped user key. Sent
 * in the login response and again in /api/sync -- the Android app rebuilds
 * its idea of "has a master password" from the sync copy, and without it
 * concludes there is none, routes to set-password, and logs the account out.
 * camelCase throughout; the app reads these names case-sensitively.
 */
export function masterPasswordUnlock(user: User) {
  return {
    kdf: {
      kdfType: user.kdf_type,
      iterations: user.kdf_iterations,
      memory: user.kdf_memory,
      parallelism: user.kdf_parallelism,
    },
    masterKeyEncryptedUserKey: user.akey,
    masterKeyWrappedUserKey: user.akey,
    salt: user.email,
  }
}
