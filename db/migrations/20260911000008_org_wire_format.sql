-- migrate:up

-- An organization as it appears in a user's profile. One definition, because
-- /api/accounts/profile and /api/sync both carry it and a difference between
-- them shows up as an organization that appears and disappears.
--
-- `key` is the org symmetric key wrapped for this member; the client unwraps it
-- with its own RSA private key. The server cannot.
create view profile_organizations as
select
  ou.user_id,
  ou.organization_id,
  jsonb_build_object(
    'id',            o.id,
    'name',          o.name,
    'key',           ou.akey,
    'status',        ou.status,
    'type',          ou.type,
    'enabled',       true,
    'seats',         null,
    'maxCollections', null,
    'maxStorageGb',  null,
    'identifier',    null,
    'permissions',   jsonb_build_object(),
    'useGroups',     false,
    'useDirectory',  false,
    'useEvents',     false,
    'useTotp',       true,
    'usePolicies',   false,
    'useSso',        false,
    'useApi',        false,
    'useResetPassword', false,
    'useSecretsManager', false,
    'usePasswordManager', true,
    'useCustomPermissions', false,
    'useActivateAutofillPolicy', false,
    'selfHost',      true,
    'usersGetPremium', true,
    'familySponsorshipFriendlyName', null,
    'familySponsorshipAvailable',    false,
    'familySponsorshipLastSyncDate', null,
    'familySponsorshipToDelete',     null,
    'familySponsorshipValidUntil',   null,
    'providerId',    null,
    'providerName',  null,
    'providerType',  null,
    'accessSecretsManager', false,
    'limitCollectionCreationDeletion', false,
    'allowAdminAccessToAllCollectionItems', true,
    'resetPasswordEnrolled', false,
    'userIsManagedByOrganization', false,
    'userId',        ou.user_id,
    'organizationUserId', ou.id,
    'hasPublicAndPrivateKeys', (o.public_key is not null and o.private_key is not null),
    'object',        'profileOrganization'
  ) as json
from organization_users ou
join organizations o on o.id = ou.organization_id;

-- Which ciphers a member may see. Owners and admins see everything in the org;
-- everyone else sees what access_all or an explicit collection grant allows.
-- Getting this wrong leaks another member's shared credentials, so it is one
-- definition rather than a filter repeated per route.
create view visible_ciphers as
select c.id as cipher_id, u.id as user_id
  from ciphers c join users u on u.id = c.user_id
union
select c.id, ou.user_id
  from ciphers c
  join organization_users ou
    on ou.organization_id = c.organization_id and ou.status = 2
 where ou.type in (0, 1) or ou.access_all
union
select c.id, cu.user_id
  from ciphers c
  join collection_ciphers cc on cc.cipher_id = c.id
  join collection_users cu on cu.collection_id = cc.collection_id
  join organization_users ou
    on ou.organization_id = c.organization_id and ou.user_id = cu.user_id and ou.status = 2;

create view visible_collections as
select cl.id as collection_id, ou.user_id
  from collections cl
  join organization_users ou
    on ou.organization_id = cl.organization_id and ou.status = 2
 where ou.type in (0, 1) or ou.access_all
union
select cu.collection_id, cu.user_id from collection_users cu;

-- migrate:down

drop view visible_collections;
drop view visible_ciphers;
drop view profile_organizations;
