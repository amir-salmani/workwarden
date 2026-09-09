import type { Sql } from './db.ts'

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
  created_at: Date
  revision_date: Date
}

export async function findByEmail(sql: Sql, email: string): Promise<User | undefined> {
  const rows = await sql<User[]>`select * from users where email = ${email.toLowerCase()}`
  return rows[0]
}

export async function findById(sql: Sql, id: string): Promise<User | undefined> {
  const rows = await sql<User[]>`select * from users where id = ${id}`
  return rows[0]
}

/** Bitwarden's own default when a client does not say otherwise. */
export const DEFAULT_KDF = { type: 0, iterations: 600_000 }
