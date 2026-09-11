--
-- PostgreSQL database dump
--


-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: citext; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;


--
-- Name: EXTENSION citext; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION citext IS 'data type for case-insensitive character strings';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: bw_timestamp(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bw_timestamp(t timestamp with time zone) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$ select to_char(t at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ciphers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ciphers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    folder_id uuid,
    type smallint NOT NULL,
    data jsonb NOT NULL,
    favorite boolean DEFAULT false NOT NULL,
    reprompt smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revision_date timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    organization_id uuid,
    CONSTRAINT ciphers_owned_by_user_xor_org CHECK ((num_nonnulls(user_id, organization_id) = 1))
);


--
-- Name: cipher_json(public.ciphers, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cipher_json(c public.ciphers, base_url text) RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
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


--
-- Name: human_size(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.human_size(bytes bigint) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$ select case
     when bytes >= 1073741824 then round(bytes / 1073741824.0, 2)::text || ' GB'
     when bytes >= 1048576    then round(bytes / 1048576.0, 2)::text || ' MB'
     when bytes >= 1024       then round(bytes / 1024.0, 2)::text || ' KB'
     else bytes::text || ' Bytes' end $$;


--
-- Name: attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attachments (
    id text NOT NULL,
    cipher_id uuid NOT NULL,
    file_name text NOT NULL,
    file_size bigint NOT NULL,
    akey text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cipher_details; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.cipher_details AS
 SELECT id,
    user_id,
    organization_id,
    folder_id,
    deleted_at,
    public.cipher_json(c.*, ''::text) AS "json"
   FROM public.ciphers c;


--
-- Name: collection_ciphers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collection_ciphers (
    collection_id uuid NOT NULL,
    cipher_id uuid NOT NULL
);


--
-- Name: collections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    external_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revision_date timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: collection_details; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.collection_details AS
 SELECT id,
    organization_id,
    jsonb_build_object('id', id, 'organizationId', organization_id, 'name', name, 'externalId', external_id, 'readOnly', false, 'hidePasswords', false, 'manage', true, 'object', 'collectionDetails') AS "json"
   FROM public.collections cl;


--
-- Name: collection_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collection_users (
    collection_id uuid NOT NULL,
    user_id uuid NOT NULL,
    read_only boolean DEFAULT false NOT NULL,
    hide_passwords boolean DEFAULT false NOT NULL,
    manage boolean DEFAULT false NOT NULL
);


--
-- Name: devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    identifier text NOT NULL,
    name text,
    type smallint DEFAULT 0 NOT NULL,
    push_token text,
    refresh_token text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revision_date timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: folders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.folders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revision_date timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: folder_details; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.folder_details AS
 SELECT id,
    user_id,
    jsonb_build_object('id', id, 'name', name, 'revisionDate', public.bw_timestamp(revision_date), 'object', 'folder') AS "json"
   FROM public.folders f;


--
-- Name: organization_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    akey text,
    status smallint DEFAULT 2 NOT NULL,
    type smallint DEFAULT 2 NOT NULL,
    access_all boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revision_date timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    billing_email text,
    private_key text,
    public_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revision_date timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profile_organizations; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.profile_organizations AS
 SELECT ou.user_id,
    ou.organization_id,
    jsonb_build_object('id', o.id, 'name', o.name, 'key', ou.akey, 'status', ou.status, 'type', ou.type, 'enabled', true, 'seats', NULL::unknown, 'maxCollections', NULL::unknown, 'maxStorageGb', NULL::unknown, 'identifier', NULL::unknown, 'permissions', jsonb_build_object(), 'useGroups', false, 'useDirectory', false, 'useEvents', false, 'useTotp', true, 'usePolicies', false, 'useSso', false, 'useApi', false, 'useResetPassword', false, 'useSecretsManager', false, 'usePasswordManager', true, 'useCustomPermissions', false, 'useActivateAutofillPolicy', false, 'selfHost', true, 'usersGetPremium', true, 'familySponsorshipFriendlyName', NULL::unknown, 'familySponsorshipAvailable', false, 'familySponsorshipLastSyncDate', NULL::unknown, 'familySponsorshipToDelete', NULL::unknown, 'familySponsorshipValidUntil', NULL::unknown, 'providerId', NULL::unknown, 'providerName', NULL::unknown, 'providerType', NULL::unknown, 'accessSecretsManager', false, 'limitCollectionCreationDeletion', false, 'allowAdminAccessToAllCollectionItems', true, 'resetPasswordEnrolled', false, 'userIsManagedByOrganization', false, 'userId', ou.user_id, 'organizationUserId', ou.id, 'hasPublicAndPrivateKeys', ((o.public_key IS NOT NULL) AND (o.private_key IS NOT NULL)), 'object', 'profileOrganization') AS "json"
   FROM (public.organization_users ou
     JOIN public.organizations o ON ((o.id = ou.organization_id)));


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email public.citext NOT NULL,
    name text,
    password_hash text,
    salt text NOT NULL,
    password_hint text,
    kdf_type smallint DEFAULT 0 NOT NULL,
    kdf_iterations integer DEFAULT 600000 NOT NULL,
    kdf_memory integer,
    kdf_parallelism integer,
    akey text NOT NULL,
    private_key text,
    public_key text,
    security_stamp uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revision_date timestamp with time zone DEFAULT now() NOT NULL,
    claim_token text,
    claimed_at timestamp with time zone,
    CONSTRAINT users_claimable_xor_usable CHECK ((num_nonnulls(password_hash, claim_token) = 1))
);


--
-- Name: vault_export; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.vault_export AS
 SELECT id AS user_id,
    email,
    jsonb_build_object('encrypted', true, 'workwarden', jsonb_build_object('formatVersion', 1, 'exportedAt', public.bw_timestamp(now()), 'account', jsonb_build_object('id', id, 'email', email, 'name', name, 'passwordHash', password_hash, 'salt', salt, 'passwordHint', password_hint, 'kdfType', kdf_type, 'kdfIterations', kdf_iterations, 'kdfMemory', kdf_memory, 'kdfParallelism', kdf_parallelism, 'key', akey, 'privateKey', private_key, 'publicKey', public_key), 'organizations', COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'key', ou.akey, 'status', ou.status, 'type', ou.type, 'accessAll', ou.access_all, 'privateKey', o.private_key, 'publicKey', o.public_key, 'collections', COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', cl.id, 'name', cl.name)) AS jsonb_agg
                   FROM public.collections cl
                  WHERE (cl.organization_id = o.id)), '[]'::jsonb))) AS jsonb_agg
           FROM (public.organization_users ou
             JOIN public.organizations o ON ((o.id = ou.organization_id)))
          WHERE (ou.user_id = u.id)), '[]'::jsonb), 'sharedItems', COALESCE(( SELECT jsonb_agg((public.cipher_json(c.*, ''::text) || jsonb_build_object('collectionIds', ( SELECT jsonb_agg(cc.collection_id) AS jsonb_agg
                   FROM public.collection_ciphers cc
                  WHERE (cc.cipher_id = c.id))))) AS jsonb_agg
           FROM public.ciphers c
          WHERE (c.organization_id IN ( SELECT organization_users.organization_id
                   FROM public.organization_users
                  WHERE (organization_users.user_id = u.id)))), '[]'::jsonb)), 'folders', COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name)) AS jsonb_agg
           FROM public.folders f
          WHERE (f.user_id = u.id)), '[]'::jsonb), 'items', COALESCE(( SELECT jsonb_agg(((((((c."json" - 'edit'::text) - 'viewPassword'::text) - 'object'::text) - 'organizationUseTotp'::text) - 'collectionIds'::text) || jsonb_build_object('collectionIds', NULL::unknown))) AS jsonb_agg
           FROM public.cipher_details c
          WHERE (c.user_id = u.id)), '[]'::jsonb)) AS export
   FROM public.users u;


--
-- Name: visible_ciphers; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.visible_ciphers AS
 SELECT c.id AS cipher_id,
    u.id AS user_id
   FROM (public.ciphers c
     JOIN public.users u ON ((u.id = c.user_id)))
UNION
 SELECT c.id AS cipher_id,
    ou.user_id
   FROM (public.ciphers c
     JOIN public.organization_users ou ON (((ou.organization_id = c.organization_id) AND (ou.status = 2))))
  WHERE ((ou.type = ANY (ARRAY[0, 1])) OR ou.access_all)
UNION
 SELECT c.id AS cipher_id,
    cu.user_id
   FROM (((public.ciphers c
     JOIN public.collection_ciphers cc ON ((cc.cipher_id = c.id)))
     JOIN public.collection_users cu ON ((cu.collection_id = cc.collection_id)))
     JOIN public.organization_users ou ON (((ou.organization_id = c.organization_id) AND (ou.user_id = cu.user_id) AND (ou.status = 2))));


--
-- Name: visible_collections; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.visible_collections AS
 SELECT cl.id AS collection_id,
    ou.user_id
   FROM (public.collections cl
     JOIN public.organization_users ou ON (((ou.organization_id = cl.organization_id) AND (ou.status = 2))))
  WHERE ((ou.type = ANY (ARRAY[0, 1])) OR ou.access_all)
UNION
 SELECT cu.collection_id,
    cu.user_id
   FROM public.collection_users cu;


--
-- Name: attachments attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_pkey PRIMARY KEY (id);


--
-- Name: ciphers ciphers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ciphers
    ADD CONSTRAINT ciphers_pkey PRIMARY KEY (id);


--
-- Name: collection_ciphers collection_ciphers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_ciphers
    ADD CONSTRAINT collection_ciphers_pkey PRIMARY KEY (collection_id, cipher_id);


--
-- Name: collection_users collection_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_users
    ADD CONSTRAINT collection_users_pkey PRIMARY KEY (collection_id, user_id);


--
-- Name: collections collections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_pkey PRIMARY KEY (id);


--
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);


--
-- Name: devices devices_user_id_identifier_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_user_id_identifier_key UNIQUE (user_id, identifier);


--
-- Name: folders folders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.folders
    ADD CONSTRAINT folders_pkey PRIMARY KEY (id);


--
-- Name: organization_users organization_users_organization_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_users
    ADD CONSTRAINT organization_users_organization_id_user_id_key UNIQUE (organization_id, user_id);


--
-- Name: organization_users organization_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_users
    ADD CONSTRAINT organization_users_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: users users_claim_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_claim_token_key UNIQUE (claim_token);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: attachments_cipher_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX attachments_cipher_id_idx ON public.attachments USING btree (cipher_id);


--
-- Name: ciphers_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ciphers_organization_id_idx ON public.ciphers USING btree (organization_id);


--
-- Name: ciphers_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ciphers_user_id_idx ON public.ciphers USING btree (user_id);


--
-- Name: collection_ciphers_cipher_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX collection_ciphers_cipher_id_idx ON public.collection_ciphers USING btree (cipher_id);


--
-- Name: collections_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX collections_organization_id_idx ON public.collections USING btree (organization_id);


--
-- Name: devices_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX devices_user_id_idx ON public.devices USING btree (user_id);


--
-- Name: folders_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX folders_user_id_idx ON public.folders USING btree (user_id);


--
-- Name: organization_users_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_users_user_id_idx ON public.organization_users USING btree (user_id);


--
-- Name: attachments attachments_cipher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_cipher_id_fkey FOREIGN KEY (cipher_id) REFERENCES public.ciphers(id) ON DELETE CASCADE;


--
-- Name: ciphers ciphers_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ciphers
    ADD CONSTRAINT ciphers_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES public.folders(id) ON DELETE SET NULL;


--
-- Name: ciphers ciphers_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ciphers
    ADD CONSTRAINT ciphers_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: ciphers ciphers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ciphers
    ADD CONSTRAINT ciphers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: collection_ciphers collection_ciphers_cipher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_ciphers
    ADD CONSTRAINT collection_ciphers_cipher_id_fkey FOREIGN KEY (cipher_id) REFERENCES public.ciphers(id) ON DELETE CASCADE;


--
-- Name: collection_ciphers collection_ciphers_collection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_ciphers
    ADD CONSTRAINT collection_ciphers_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES public.collections(id) ON DELETE CASCADE;


--
-- Name: collection_users collection_users_collection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_users
    ADD CONSTRAINT collection_users_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES public.collections(id) ON DELETE CASCADE;


--
-- Name: collection_users collection_users_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collection_users
    ADD CONSTRAINT collection_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: collections collections_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: devices devices_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: folders folders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.folders
    ADD CONSTRAINT folders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: organization_users organization_users_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_users
    ADD CONSTRAINT organization_users_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_users organization_users_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_users
    ADD CONSTRAINT organization_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


