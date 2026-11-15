import type { Db } from './db.ts'

export type User = {
  id: string
  email: string
  name: string | null
  password_hash: string
  salt: string
  password_hint: string | null
  kdf_type: number
  kdf_iterations: number
  kdf_memory: number | null
  kdf_parallelism: number | null
  akey: string
  private_key: string | null
  public_key: string | null
  security_stamp: string
  created_at: string
  revision_date: string
}

export function findByEmail(db: Db, email: string) {
  return db.prepare('select * from users where email = ?').bind(email.toLowerCase()).first<User>()
}

export function findById(db: Db, id: string) {
  return db.prepare('select * from users where id = ?').bind(id).first<User>()
}

/** Bitwarden's own default when a client does not say otherwise. */
export const DEFAULT_KDF = { type: 0, iterations: 600_000 }
