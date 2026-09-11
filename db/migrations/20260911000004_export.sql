-- migrate:up

-- The backup artifact required by FEASIBILITY.md §2.4: everything needed to
-- stand the vault up somewhere else, in Bitwarden's shape, containing no
-- plaintext.
--
-- `items` and `folders` are exactly Bitwarden's export format. The `account`
-- block is the addition that makes the export *restorable* rather than merely
-- readable: the protected symmetric key and the RSA keypair, all of which are
-- ciphertext under the user's master key, plus the KDF parameters a client
-- needs to derive that key again.
--
-- Restore is server-side, and that is not a shortcut. `bw import` of an
-- account-encrypted export requires `encKeyValidation_DO_NOT_EDIT` -- a GUID
-- encrypted with the user key, which only a client can mint. A server that
-- could produce it would be a server that could read your vault. See
-- docs/BACKUP.md.
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
        'id', u.id,
        'email', u.email,
        'name', u.name,
        'passwordHash', u.password_hash,
        'salt', u.salt,
        'passwordHint', u.password_hint,
        'kdfType', u.kdf_type,
        'kdfIterations', u.kdf_iterations,
        'kdfMemory', u.kdf_memory,
        'kdfParallelism', u.kdf_parallelism,
        'key', u.akey,
        'privateKey', u.private_key,
        'publicKey', u.public_key
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

drop view vault_export;
