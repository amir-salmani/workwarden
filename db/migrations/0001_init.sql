-- One person's vault. Timestamps are ISO 8601 UTC strings as JavaScript writes
-- them; ids are UUIDs minted by the Worker. Every secret column is ciphertext
-- the client produced -- the server never holds a key that opens any of it.

create table users (
  id              text primary key,
  email           text not null unique,          -- lowercased
  name            text,
  -- Server-side auth hash: PBKDF2(client hash, salt, 10k) then HMAC with the
  -- pepper, which lives in a Worker secret and never in this database.
  password_hash   text not null,
  salt            text not null,
  password_hint   text,
  -- Client-side KDF parameters, echoed back at prelogin.
  kdf_type        integer not null default 0,
  kdf_iterations  integer not null default 600000,
  kdf_memory      integer,
  kdf_parallelism integer,
  -- Opaque: the protected symmetric key and the RSA keypair.
  akey            text not null,
  private_key     text,
  public_key      text,
  -- Rotating it invalidates every issued token.
  security_stamp  text not null,
  created_at      text not null,
  revision_date   text not null
);

create table devices (
  id              text primary key,
  user_id         text not null references users(id) on delete cascade,
  identifier      text not null,
  name            text,
  type            integer not null default 0,
  refresh_token   text,
  created_at      text not null,
  revision_date   text not null,
  unique (user_id, identifier)
);

create table folders (
  id              text primary key,
  user_id         text not null references users(id) on delete cascade,
  name            text not null,
  created_at      text not null,
  revision_date   text not null
);

create table ciphers (
  id              text primary key,
  user_id         text not null references users(id) on delete cascade,
  folder_id       text references folders(id) on delete set null,
  type            integer not null,
  -- The client's encrypted blob, stored whole as JSON text. Server-owned
  -- fields are overlaid on read, never parsed out on write.
  data            text not null,
  favorite        integer not null default 0,
  reprompt        integer not null default 0,
  created_at      text not null,
  revision_date   text not null,
  deleted_at      text
);

create index ciphers_user_id_idx on ciphers (user_id);
create index folders_user_id_idx on folders (user_id);
create index devices_refresh_token_idx on devices (refresh_token);
