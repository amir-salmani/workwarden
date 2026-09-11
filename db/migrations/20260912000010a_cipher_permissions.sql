-- migrate:up

-- Send each cipher's delete/restore permissions.
--
-- Newer clients build CipherPermissionsApi from a `permissions` object, and it
-- defaults delete and restore to false when the object is absent. We never sent
-- one, so every item refused Delete and Restore in the client -- a 200 from the
-- server and then "You do not have permission to delete this item".
--
-- Personal ciphers belong to the user outright, so both are always true.
create or replace function cipher_json(c ciphers, base_url text) returns jsonb
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
    'permissions',    jsonb_build_object('delete', true, 'restore', true),
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

-- migrate:down

create or replace function cipher_json(c ciphers, base_url text) returns jsonb
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
