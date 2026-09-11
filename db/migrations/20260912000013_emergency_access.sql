-- migrate:up

-- Emergency access: a trusted person who can reach this vault if its owner
-- cannot. `key_encrypted` is the account key wrapped to the grantee's public
-- key, so the grant is only readable by the grantee -- the server stores a
-- ciphertext it cannot open, same as everything else here.
create table emergency_accesses (
  id            uuid primary key default gen_random_uuid(),
  grantor_id    uuid not null references users(id) on delete cascade,
  grantee_id    uuid references users(id) on delete cascade,
  email         text,
  key_encrypted text,
  type          smallint not null default 0,  -- 0 view, 1 takeover
  status        smallint not null default 0,  -- 0 invited, 1 accepted, 2 confirmed, 3 recovery initiated, 4 recovery approved
  wait_time_days integer not null default 7,
  recovery_initiated_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index emergency_accesses_grantor_idx on emergency_accesses (grantor_id);
create index emergency_accesses_grantee_idx on emergency_accesses (grantee_id);

-- migrate:down

drop table emergency_accesses;
