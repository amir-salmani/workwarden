-- migrate:up

create table attachments (
  id         text primary key,          -- Vaultwarden's opaque id, not a uuid
  cipher_id  uuid not null references ciphers(id) on delete cascade,
  file_name  text not null,             -- EncString
  file_size  bigint not null,
  akey       text,                      -- the attachment's own key, EncString
  created_at timestamptz not null default now()
);

create index attachments_cipher_id_idx on attachments (cipher_id);

create function human_size(bytes bigint) returns text
  language sql immutable as
$$ select case
     when bytes >= 1073741824 then round(bytes / 1073741824.0, 2)::text || ' GB'
     when bytes >= 1048576    then round(bytes / 1048576.0, 2)::text || ' MB'
     when bytes >= 1024       then round(bytes / 1024.0, 2)::text || ' KB'
     else bytes::text || ' Bytes' end $$;

-- The cipher wire format becomes a function because an attachment carries an
-- absolute download URL, so the JSON now depends on the server's origin. One
-- definition still, just parameterised -- sync and the CRUD routes pass the
-- request origin, and the export passes an empty base because a backup has no
-- server to point at.
create function cipher_json(c ciphers, base_url text) returns jsonb
  language sql stable as
$$
  select c.data || jsonb_build_object(
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
    'organizationUseTotp', true,
    'key',            coalesce(c.data -> 'key', 'null'::jsonb),
    'creationDate',   bw_timestamp(c.created_at),
    'revisionDate',   bw_timestamp(c.revision_date),
    'deletedDate',    case when c.deleted_at is null then null
                           else to_jsonb(bw_timestamp(c.deleted_at)) end,
    'object',         'cipherDetails'
  )
$$;

drop view vault_export;
drop view cipher_details;

create view cipher_details as
select c.id, c.user_id, c.organization_id, c.folder_id, c.deleted_at,
       cipher_json(c, '') as json
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
      ),
      -- Organizations a backup cannot restore without: the wrapped org key is
      -- the only way back into shared ciphers.
      'organizations', coalesce(
        (select jsonb_agg(jsonb_build_object(
           'id', o.id, 'name', o.name, 'key', ou.akey,
           'status', ou.status, 'type', ou.type, 'accessAll', ou.access_all,
           'privateKey', o.private_key, 'publicKey', o.public_key,
           'collections', coalesce(
             (select jsonb_agg(jsonb_build_object('id', cl.id, 'name', cl.name))
                from collections cl where cl.organization_id = o.id), '[]'::jsonb)))
           from organization_users ou join organizations o on o.id = ou.organization_id
          where ou.user_id = u.id), '[]'::jsonb),
      'sharedItems', coalesce(
        (select jsonb_agg(cipher_json(c, '') || jsonb_build_object(
           'collectionIds',
           (select jsonb_agg(cc.collection_id) from collection_ciphers cc where cc.cipher_id = c.id)))
           from ciphers c
          where c.organization_id in
            (select organization_id from organization_users where user_id = u.id)), '[]'::jsonb)
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

drop view vault_export;
drop view cipher_details;
drop function cipher_json(ciphers, text);
drop function human_size(bigint);
drop table attachments;

create view cipher_details as
select c.id, c.user_id, c.organization_id, c.folder_id, c.deleted_at,
  c.data || jsonb_build_object(
    'id', c.id, 'organizationId', c.organization_id, 'folderId', c.folder_id,
    'type', c.type, 'favorite', c.favorite, 'reprompt', c.reprompt,
    'edit', true, 'viewPassword', true,
    'collectionIds', coalesce(
      (select jsonb_agg(cc.collection_id) from collection_ciphers cc where cc.cipher_id = c.id),
      '[]'::jsonb),
    'attachments', null, 'organizationUseTotp', true,
    'key', coalesce(c.data -> 'key', 'null'::jsonb),
    'creationDate', bw_timestamp(c.created_at),
    'revisionDate', bw_timestamp(c.revision_date),
    'deletedDate', case when c.deleted_at is null then null
                        else to_jsonb(bw_timestamp(c.deleted_at)) end,
    'object', 'cipherDetails'
  ) as json
from ciphers c;

create view vault_export as
select u.id as user_id, u.email,
  jsonb_build_object(
    'encrypted', true,
    'workwarden', jsonb_build_object('formatVersion', 1, 'exportedAt', bw_timestamp(now()),
      'account', jsonb_build_object('id', u.id, 'email', u.email, 'name', u.name,
        'passwordHash', u.password_hash, 'salt', u.salt, 'passwordHint', u.password_hint,
        'kdfType', u.kdf_type, 'kdfIterations', u.kdf_iterations, 'kdfMemory', u.kdf_memory,
        'kdfParallelism', u.kdf_parallelism, 'key', u.akey,
        'privateKey', u.private_key, 'publicKey', u.public_key)),
    'folders', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name))
       from folders f where f.user_id = u.id), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(
         (c.json - 'edit' - 'viewPassword' - 'object' - 'attachments'
                 - 'organizationUseTotp' - 'collectionIds')
         || jsonb_build_object('collectionIds', null))
       from cipher_details c where c.user_id = u.id), '[]'::jsonb)
  ) as export
from users u;
