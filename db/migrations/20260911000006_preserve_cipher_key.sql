-- migrate:up

-- Restore each cipher's own key.
--
-- 20260911000003 added 'key', null to jsonb_build_object while fixing
-- organizationUseTotp. `data || jsonb_build_object(...)` lets the right side
-- win, so that null overwrote the per-item key that Bitwarden uses to encrypt
-- an individual cipher. Items carrying one became undecryptable -- the client
-- reports "Decryption error" for exactly those.
--
-- The field must still be present when absent, so coalesce rather than drop.
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
    'key',            coalesce(c.data -> 'key', 'null'::jsonb),
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
  c.id, c.user_id, c.folder_id, c.deleted_at,
  c.data || jsonb_build_object(
    'id', c.id, 'organizationId', null, 'folderId', c.folder_id,
    'type', c.type, 'favorite', c.favorite, 'reprompt', c.reprompt,
    'edit', true, 'viewPassword', true, 'collectionIds', jsonb_build_array(),
    'attachments', null, 'organizationUseTotp', false, 'key', null,
    'creationDate', bw_timestamp(c.created_at),
    'revisionDate', bw_timestamp(c.revision_date),
    'deletedDate', case when c.deleted_at is null then null
                        else to_jsonb(bw_timestamp(c.deleted_at)) end,
    'object', 'cipherDetails'
  ) as json
from ciphers c;
