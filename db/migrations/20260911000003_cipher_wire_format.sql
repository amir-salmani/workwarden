-- migrate:up

-- Three fields the server must own, all found by driving a real client.
--
--   attachments  must be null or an array. The client does
--                `if (attachments != null) attachments.map(...)`, so the empty
--                object it sends on create crashes it when echoed back.
--                Real attachments arrive with R2 in Phase 3.
--   organizationUseTotp  deserialises into a non-optional bool in the client's
--                Rust SDK: omitting it fails with "invalid type: unit value,
--                expected a boolean" -- after a 200.
--   key          the per-cipher key. Null until we issue them.
create or replace view cipher_details as
select
  c.id,
  c.user_id,
  c.folder_id,
  c.deleted_at,
  c.data || jsonb_build_object(
    'id',             c.id,
    'organizationId', null,
    'folderId',       c.folder_id,
    'type',           c.type,
    'favorite',       c.favorite,
    'reprompt',       c.reprompt,
    'edit',           true,
    'viewPassword',   true,
    'collectionIds',  jsonb_build_array(),
    'attachments',    null,
    'organizationUseTotp', false,
    'key',            null,
    'creationDate',   bw_timestamp(c.created_at),
    'revisionDate',   bw_timestamp(c.revision_date),
    'deletedDate',    case when c.deleted_at is null then null
                           else to_jsonb(bw_timestamp(c.deleted_at)) end,
    'object',         'cipherDetails'
  ) as json
from ciphers c;

-- migrate:down

create or replace view cipher_details as
select
  c.id,
  c.user_id,
  c.folder_id,
  c.deleted_at,
  c.data || jsonb_build_object(
    'id',             c.id,
    'organizationId', null,
    'folderId',       c.folder_id,
    'type',           c.type,
    'favorite',       c.favorite,
    'reprompt',       c.reprompt,
    'edit',           true,
    'viewPassword',   true,
    'collectionIds',  jsonb_build_array(),
    'creationDate',   bw_timestamp(c.created_at),
    'revisionDate',   bw_timestamp(c.revision_date),
    'deletedDate',    case when c.deleted_at is null then null
                           else to_jsonb(bw_timestamp(c.deleted_at)) end,
    'object',         'cipherDetails'
  ) as json
from ciphers c;
