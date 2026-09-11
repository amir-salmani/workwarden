-- migrate:up

-- Bitwarden Sends: a one-off encrypted share with its own key, optionally
-- password-protected, with an expiry and an access count.
--
-- The payload is ciphertext under a key the recipient gets from the URL
-- fragment, which browsers never transmit -- so the server holds the data and
-- never the means to read it, even for an anonymous download.
create table sends (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references users(id) on delete cascade,
  type           smallint not null,          -- 0 text, 1 file
  name           text not null,              -- EncString
  notes          text,                       -- EncString
  data           jsonb not null default '{}',
  akey           text not null,              -- the send's own key, EncString
  password_hash  text,                       -- server-side hash of the access password
  password_salt  text,
  max_access_count integer,
  access_count   integer not null default 0,
  expiration_date  timestamptz,
  deletion_date    timestamptz not null,
  disabled       boolean not null default false,
  hide_email     boolean not null default false,
  created_at     timestamptz not null default now(),
  revision_date  timestamptz not null default now()
);

create index sends_user_id_idx on sends (user_id);

create view send_details as
select
  s.id,
  s.user_id,
  jsonb_build_object(
    'id',             s.id,
    'accessId',       replace(s.id::text, '-', ''),
    'type',           s.type,
    'name',           s.name,
    'notes',          s.notes,
    'file',           case when s.type = 1 then s.data else null end,
    'text',           case when s.type = 0 then s.data else null end,
    'key',            s.akey,
    'maxAccessCount', s.max_access_count,
    'accessCount',    s.access_count,
    'password',       s.password_hash,
    'disabled',       s.disabled,
    'hideEmail',      s.hide_email,
    'revisionDate',   bw_timestamp(s.revision_date),
    'expirationDate', case when s.expiration_date is null then null
                           else to_jsonb(bw_timestamp(s.expiration_date)) end,
    'deletionDate',   bw_timestamp(s.deletion_date),
    'object',         'send'
  ) as json
from sends s;

-- migrate:down

drop view send_details;
drop table sends;
