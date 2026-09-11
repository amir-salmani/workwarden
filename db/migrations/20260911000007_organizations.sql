-- migrate:up

-- Organizations, collections, and shared ciphers.
--
-- The org's symmetric key is stored per member in organization_users.akey,
-- already encrypted with that member's RSA public key. The server stores and
-- serves it and can never open it -- the same zero-knowledge shape as a
-- personal vault, one level up.
create table organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  billing_email text,
  -- The org RSA keypair. private_key is encrypted under the org symmetric key.
  private_key   text,
  public_key    text,
  created_at    timestamptz not null default now(),
  revision_date timestamptz not null default now()
);

create table organization_users (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  -- The org key, wrapped for this member.
  akey            text,
  status          smallint not null default 2,  -- 0 invited, 1 accepted, 2 confirmed
  type            smallint not null default 2,  -- 0 owner, 1 admin, 2 user, 3 manager
  access_all      boolean  not null default false,
  created_at      timestamptz not null default now(),
  revision_date   timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table collections (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  external_id     text,
  created_at      timestamptz not null default now(),
  revision_date   timestamptz not null default now()
);

create table collection_users (
  collection_id  uuid not null references collections(id) on delete cascade,
  user_id        uuid not null references users(id) on delete cascade,
  read_only      boolean not null default false,
  hide_passwords boolean not null default false,
  manage         boolean not null default false,
  primary key (collection_id, user_id)
);

-- A cipher belongs to a user or to an organization, never both and never
-- neither: an org cipher has no owner, and orphaning one would make it
-- invisible to everybody while still occupying the vault.
alter table ciphers alter column user_id drop not null;
alter table ciphers add column organization_id uuid references organizations(id) on delete cascade;
alter table ciphers add constraint ciphers_owned_by_user_xor_org
  check (num_nonnulls(user_id, organization_id) = 1);

create table collection_ciphers (
  collection_id uuid not null references collections(id) on delete cascade,
  cipher_id     uuid not null references ciphers(id) on delete cascade,
  primary key (collection_id, cipher_id)
);

create index organization_users_user_id_idx on organization_users (user_id);
create index collections_organization_id_idx on collections (organization_id);
create index ciphers_organization_id_idx on ciphers (organization_id);
create index collection_ciphers_cipher_id_idx on collection_ciphers (cipher_id);

-- organizationId and collectionIds now come from the data rather than being
-- hard-coded null and empty. CREATE OR REPLACE cannot add or reorder a view's
-- columns, and vault_export reads cipher_details, so both are rebuilt.
drop view vault_export;
drop view cipher_details;

create view cipher_details as
select
  c.id,
  c.user_id,
  c.organization_id,
  c.folder_id,
  c.deleted_at,
  c.data || jsonb_build_object(
    'id',             c.id,
    'organizationId', c.organization_id,
    'folderId',       c.folder_id,
    'type',           c.type,
    'favorite',       c.favorite,
    'reprompt',       c.reprompt,
    'edit',           true,
    'viewPassword',   true,
    'collectionIds',  coalesce(
      (select jsonb_agg(cc.collection_id) from collection_ciphers cc where cc.cipher_id = c.id),
      '[]'::jsonb),
    'attachments',    null,
    'organizationUseTotp', true,
    'key',            coalesce(c.data -> 'key', 'null'::jsonb),
    'creationDate',   bw_timestamp(c.created_at),
    'revisionDate',   bw_timestamp(c.revision_date),
    'deletedDate',    case when c.deleted_at is null then null
                           else to_jsonb(bw_timestamp(c.deleted_at)) end,
    'object',         'cipherDetails'
  ) as json
from ciphers c;

create view collection_details as
select
  cl.id,
  cl.organization_id,
  jsonb_build_object(
    'id',             cl.id,
    'organizationId', cl.organization_id,
    'name',           cl.name,
    'externalId',     cl.external_id,
    'readOnly',       false,
    'hidePasswords',  false,
    'manage',         true,
    'object',         'collectionDetails'
  ) as json
from collections cl;

create view vault_export as
select
  u.id as user_id,
  u.email,
  jsonb_build_object(
    'encrypted', true,
    'workwarden', jsonb_build_object(
      'formatVersion', 1,
      'exportedAt', bw_timestamp(now()),
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
         (c.json - 'edit' - 'viewPassword' - 'object' - 'attachments'
                 - 'organizationUseTotp' - 'collectionIds')
         || jsonb_build_object('collectionIds', null))
       from cipher_details c where c.user_id = u.id), '[]'::jsonb)
  ) as export
from users u;

-- migrate:down

-- Views first: cipher_details reads collection_ciphers, and CREATE OR REPLACE
-- cannot drop a view's columns, so both views are rebuilt rather than replaced.
drop view vault_export;
drop view collection_details;
drop view cipher_details;

drop table collection_ciphers;
alter table ciphers drop constraint ciphers_owned_by_user_xor_org;
delete from ciphers where user_id is null;
alter table ciphers drop column organization_id;
alter table ciphers alter column user_id set not null;
drop table collection_users;
drop table collections;
drop table organization_users;
drop table organizations;

create view cipher_details as
select c.id, c.user_id, c.folder_id, c.deleted_at,
  c.data || jsonb_build_object(
    'id', c.id, 'organizationId', null, 'folderId', c.folder_id,
    'type', c.type, 'favorite', c.favorite, 'reprompt', c.reprompt,
    'edit', true, 'viewPassword', true, 'collectionIds', jsonb_build_array(),
    'attachments', null, 'organizationUseTotp', false,
    'key', coalesce(c.data -> 'key', 'null'::jsonb),
    'creationDate', bw_timestamp(c.created_at),
    'revisionDate', bw_timestamp(c.revision_date),
    'deletedDate', case when c.deleted_at is null then null
                        else to_jsonb(bw_timestamp(c.deleted_at)) end,
    'object', 'cipherDetails'
  ) as json
from ciphers c;

create view vault_export as
select
  u.id as user_id, u.email,
  jsonb_build_object(
    'encrypted', true,
    'workwarden', jsonb_build_object(
      'formatVersion', 1, 'exportedAt', bw_timestamp(now()),
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
         (c.json - 'edit' - 'viewPassword' - 'object' - 'attachments'
                 - 'organizationUseTotp' - 'collectionIds')
         || jsonb_build_object('collectionIds', null))
       from cipher_details c where c.user_id = u.id), '[]'::jsonb)
  ) as export
from users u;
