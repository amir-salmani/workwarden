-- migrate:up

-- Bitwarden's wire format for a cipher and a folder, defined once. /api/sync and
-- the CRUD routes both read these, so the two cannot drift into disagreeing
-- about a field -- which would desync clients while every test stayed green.

create function bw_timestamp(t timestamptz) returns text
  language sql immutable as
$$ select to_char(t at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') $$;

create view cipher_details as
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

create view folder_details as
select
  f.id,
  f.user_id,
  jsonb_build_object(
    'id',           f.id,
    'name',         f.name,
    'revisionDate', bw_timestamp(f.revision_date),
    'object',       'folder'
  ) as json
from folders f;

-- migrate:down

drop view folder_details;
drop view cipher_details;
drop function bw_timestamp(timestamptz);
