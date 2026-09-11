-- migrate:up

-- Second factors for login. `secret` is the TOTP seed and `recovery` the
-- one-shot escape hatch, both stored in the clear relative to the vault: they
-- guard the login, not the ciphertext. Someone who steals this table can pass
-- the second factor and still faces a vault they cannot read without the
-- master password.
create table two_factors (
  user_id    uuid not null references users(id) on delete cascade,
  type       smallint not null,        -- 0 authenticator (TOTP)
  enabled    boolean not null default true,
  secret     text not null,
  recovery   text,
  last_used_step bigint,               -- blocks replay of a code within its window
  created_at timestamptz not null default now(),
  primary key (user_id, type)
);

-- migrate:down

drop table two_factors;
