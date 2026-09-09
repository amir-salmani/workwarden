-- migrate:up

create extension if not exists "pgcrypto";
create extension if not exists "citext";

create table users (
  id                    uuid primary key default gen_random_uuid(),
  email                 citext not null unique,
  name                  text,

  -- Our server-side hash: PBKDF2(client hash, salt, 10k) then HMAC with the
  -- pepper. Salt is random per user; Phase 0 used the email and does not carry.
  password_hash         text not null,
  salt                  text not null,
  password_hint         text,

  -- Client-side KDF parameters. The client owns these; we only echo them back
  -- at /api/accounts/prelogin so it knows how to derive its key.
  kdf_type              smallint not null default 0,
  kdf_iterations        integer  not null default 600000,
  kdf_memory            integer,
  kdf_parallelism       integer,

  -- Opaque to us: the protected symmetric key and the RSA keypair.
  akey                  text not null,
  private_key           text,
  public_key            text,

  -- Rotating it invalidates every issued token.
  security_stamp        uuid not null default gen_random_uuid(),

  created_at            timestamptz not null default now(),
  revision_date         timestamptz not null default now()
);

create table devices (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  identifier            text not null,
  name                  text,
  type                  smallint not null default 0,
  push_token            text,
  refresh_token         text,
  created_at            timestamptz not null default now(),
  revision_date         timestamptz not null default now(),
  unique (user_id, identifier)
);

create table folders (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  name                  text not null,
  created_at            timestamptz not null default now(),
  revision_date         timestamptz not null default now()
);

create table ciphers (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  folder_id             uuid references folders(id) on delete set null,
  type                  smallint not null,

  -- The client's encrypted blob, stored whole. Server-managed fields are
  -- overlaid on read rather than parsed out on write.
  data                  jsonb not null,

  favorite              boolean not null default false,
  reprompt              smallint not null default 0,
  created_at            timestamptz not null default now(),
  revision_date         timestamptz not null default now(),
  deleted_at            timestamptz
);

create index ciphers_user_id_idx on ciphers (user_id);
create index folders_user_id_idx on folders (user_id);
create index devices_user_id_idx on devices (user_id);

-- migrate:down

drop table ciphers;
drop table folders;
drop table devices;
drop table users;
