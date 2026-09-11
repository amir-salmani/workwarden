-- migrate:up

-- Remove organizations entirely. This vault has one user; sharing was overhead
-- that bought nothing and cost an entire second key hierarchy.
--
-- IRREVERSIBLE for data. scripts/flatten-orgs.mjs must have run first: it copies
-- every shared cipher into a personal folder, re-encrypted under the account
-- key, because only a client can do that. Dropping these tables destroys the
-- originals, and nothing in this migration can put them back.
--
-- The down migration restores the shape, not the rows.

drop view vault_export;
drop view cipher_details;
drop view collection_details;
drop view visible_ciphers;
drop view visible_collections;
drop view profile_organizations;
drop function cipher_json(ciphers, text);

delete from ciphers where organization_id is not null;

alter table ciphers drop constraint ciphers_owned_by_user_xor_org;
alter table ciphers drop column organization_id;
alter table ciphers alter column user_id set not null;

drop table collection_ciphers;
drop table collection_users;
drop table collections;
drop table organization_users;
drop table organizations;

create function cipher_json(c ciphers, base_url text) returns jsonb
  language sql stable as
$$
  select c.data || jsonb_build_object(
    'id',             c.id,
    'organizationId', null,
    'folderId',       c.folder_id,
    'type',           c.type,
    'favorite',       c.favorite,
    'reprompt',       c.reprompt,
    'edit',           true,
    'viewPassword',   true,
    'permissions',    jsonb_build_object('delete', true, 'restore', true),
    'collectionIds',  '[]'::jsonb,
    'attachments',    (
      select jsonb_agg(jsonb_build_object(
        'id',       a.id,
        'url',      base_url || '/attachments/' || c.id || '/' || a.id,
        'fileName', a.file_name,
        'key',      a.akey,
        'size',     a.file_size::text,
        'sizeName', human_size(a.file_size),
        'object',   'attachment'
      ) order by a.id)
      from attachments a where a.cipher_id = c.id
    ),
    'organizationUseTotp', false,
    'key',            coalesce(c.data -> 'key', 'null'::jsonb),
    'creationDate',   bw_timestamp(c.created_at),
    'revisionDate',   bw_timestamp(c.revision_date),
    'deletedDate',    case when c.deleted_at is null then null
                           else to_jsonb(bw_timestamp(c.deleted_at)) end,
    'object',         'cipherDetails'
  )
$$;

create view cipher_details as
select c.id, c.user_id, c.folder_id, c.deleted_at, cipher_json(c, '') as json
from ciphers c;

create view vault_export as
select
  u.id as user_id, u.email,
  jsonb_build_object(
    'encrypted', true,
    'workwarden', jsonb_build_object(
      'formatVersion', 2, 'exportedAt', bw_timestamp(now()),
      'account', jsonb_build_object(
        'id', u.id, 'email', u.email, 'name', u.name,
        'passwordHash', u.password_hash, 'salt', u.salt,
        'passwordHint', u.password_hint, 'kdfType', u.kdf_type,
        'kdfIterations', u.kdf_iterations, 'kdfMemory', u.kdf_memory,
        'kdfParallelism', u.kdf_parallelism, 'key', u.akey,
        'privateKey', u.private_key, 'publicKey', u.public_key
      )
    ),
    'folders', coalesce(
      (select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name))
       from folders f where f.user_id = u.id), '[]'::jsonb),
    'items', coalesce(
      (select jsonb_agg(
         (c.json - 'edit' - 'viewPassword' - 'object' - 'organizationUseTotp' - 'collectionIds')
         || jsonb_build_object('collectionIds', null))
       from cipher_details c where c.user_id = u.id), '[]'::jsonb)
  ) as export
from users u;

-- migrate:down

-- Restores the schema, not the data. Anything that lived in an organization is
-- gone by the time this runs.
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null, billing_email text, private_key text, public_key text,
  created_at timestamptz not null default now(),
  revision_date timestamptz not null default now()
);
create table organization_users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  akey text, status smallint not null default 2, type smallint not null default 2,
  access_all boolean not null default false,
  created_at timestamptz not null default now(),
  revision_date timestamptz not null default now(),
  unique (organization_id, user_id)
);
create table collections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null, external_id text,
  created_at timestamptz not null default now(),
  revision_date timestamptz not null default now()
);
create table collection_users (
  collection_id uuid not null references collections(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  read_only boolean not null default false,
  hide_passwords boolean not null default false,
  manage boolean not null default false,
  primary key (collection_id, user_id)
);
alter table ciphers alter column user_id drop not null;
alter table ciphers add column organization_id uuid references organizations(id) on delete cascade;
alter table ciphers add constraint ciphers_owned_by_user_xor_org
  check (num_nonnulls(user_id, organization_id) = 1);
create table collection_ciphers (
  collection_id uuid not null references collections(id) on delete cascade,
  cipher_id uuid not null references ciphers(id) on delete cascade,
  primary key (collection_id, cipher_id)
);
create index organization_users_user_id_idx on organization_users (user_id);
create index collections_organization_id_idx on collections (organization_id);
create index ciphers_organization_id_idx on ciphers (organization_id);
create index collection_ciphers_cipher_id_idx on collection_ciphers (cipher_id);

drop view vault_export;
drop view cipher_details;
drop function cipher_json(ciphers, text);

create function cipher_json(c ciphers, base_url text) returns jsonb
  language sql stable as
$$
  select c.data || jsonb_build_object(
    'id', c.id, 'organizationId', c.organization_id, 'folderId', c.folder_id,
    'type', c.type, 'favorite', c.favorite, 'reprompt', c.reprompt,
    'edit', true, 'viewPassword', true,
    'collectionIds', coalesce(
      (select jsonb_agg(cc.collection_id) from collection_ciphers cc where cc.cipher_id = c.id),
      '[]'::jsonb),
    'attachments', (
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'url', base_url || '/attachments/' || c.id || '/' || a.id,
        'fileName', a.file_name, 'key', a.akey, 'size', a.file_size::text,
        'sizeName', human_size(a.file_size), 'object', 'attachment') order by a.id)
      from attachments a where a.cipher_id = c.id),
    'organizationUseTotp', true,
    'key', coalesce(c.data -> 'key', 'null'::jsonb),
    'creationDate', bw_timestamp(c.created_at),
    'revisionDate', bw_timestamp(c.revision_date),
    'deletedDate', case when c.deleted_at is null then null
                        else to_jsonb(bw_timestamp(c.deleted_at)) end,
    'object', 'cipherDetails')
$$;

create view cipher_details as
select c.id, c.user_id, c.organization_id, c.folder_id, c.deleted_at,
       cipher_json(c, '') as json
from ciphers c;

create view collection_details as
select cl.id, cl.organization_id,
  jsonb_build_object('id', cl.id, 'organizationId', cl.organization_id,
    'name', cl.name, 'externalId', cl.external_id, 'readOnly', false,
    'hidePasswords', false, 'manage', true, 'object', 'collectionDetails') as json
from collections cl;

create view profile_organizations as
select ou.user_id, ou.organization_id,
  jsonb_build_object('id', o.id, 'name', o.name, 'key', ou.akey,
    'status', ou.status, 'type', ou.type, 'enabled', true,
    'object', 'profileOrganization') as json
from organization_users ou join organizations o on o.id = ou.organization_id;

create view visible_ciphers as
select c.id as cipher_id, u.id as user_id from ciphers c join users u on u.id = c.user_id
union
select c.id, ou.user_id from ciphers c
  join organization_users ou on ou.organization_id = c.organization_id and ou.status = 2
 where ou.type in (0, 1) or ou.access_all;

create view visible_collections as
select cl.id as collection_id, ou.user_id from collections cl
  join organization_users ou on ou.organization_id = cl.organization_id and ou.status = 2
 where ou.type in (0, 1) or ou.access_all
union
select cu.collection_id, cu.user_id from collection_users cu;

create view vault_export as
select u.id as user_id, u.email,
  jsonb_build_object('encrypted', true,
    'workwarden', jsonb_build_object('formatVersion', 1, 'exportedAt', bw_timestamp(now()),
      'account', jsonb_build_object('id', u.id, 'email', u.email, 'name', u.name,
        'passwordHash', u.password_hash, 'salt', u.salt, 'passwordHint', u.password_hint,
        'kdfType', u.kdf_type, 'kdfIterations', u.kdf_iterations,
        'kdfMemory', u.kdf_memory, 'kdfParallelism', u.kdf_parallelism,
        'key', u.akey, 'privateKey', u.private_key, 'publicKey', u.public_key)),
    'folders', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name))
       from folders f where f.user_id = u.id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(
         (c.json - 'edit' - 'viewPassword' - 'object' - 'organizationUseTotp' - 'collectionIds')
         || jsonb_build_object('collectionIds', null))
       from cipher_details c where c.user_id = u.id), '[]'::jsonb)) as export
from users u;
