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
    user_id uuid NOT NULL,
    folder_id uuid,
    type smallint NOT NULL,
    data jsonb NOT NULL,
    favorite boolean DEFAULT false NOT NULL,
    reprompt smallint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revision_date timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: cipher_json(public.ciphers, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cipher_json(c public.ciphers, base_url text) RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
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
    folder_id,
    deleted_at,
    public.cipher_json(c.*, ''::text) AS "json"
   FROM public.ciphers c;


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
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: sends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sends (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    type smallint NOT NULL,
    name text NOT NULL,
    notes text,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    akey text NOT NULL,
    password_hash text,
    password_salt text,
    max_access_count integer,
    access_count integer DEFAULT 0 NOT NULL,
    expiration_date timestamp with time zone,
    deletion_date timestamp with time zone NOT NULL,
    disabled boolean DEFAULT false NOT NULL,
    hide_email boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revision_date timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: send_details; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.send_details AS
 SELECT id,
    user_id,
    jsonb_build_object('id', id, 'accessId', replace((id)::text, '-'::text, ''::text), 'type', type, 'name', name, 'notes', notes, 'file',
        CASE
            WHEN (type = 1) THEN data
            ELSE NULL::jsonb
        END, 'text',
        CASE
            WHEN (type = 0) THEN data
            ELSE NULL::jsonb
        END, 'key', akey, 'maxAccessCount', max_access_count, 'accessCount', access_count, 'password', password_hash, 'disabled', disabled, 'hideEmail', hide_email, 'revisionDate', public.bw_timestamp(revision_date), 'expirationDate',
        CASE
            WHEN (expiration_date IS NULL) THEN NULL::jsonb
            ELSE to_jsonb(public.bw_timestamp(expiration_date))
        END, 'deletionDate', public.bw_timestamp(deletion_date), 'object', 'send') AS "json"
   FROM public.sends s;


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
    jsonb_build_object('encrypted', true, 'workwarden', jsonb_build_object('formatVersion', 2, 'exportedAt', public.bw_timestamp(now()), 'account', jsonb_build_object('id', id, 'email', email, 'name', name, 'passwordHash', password_hash, 'salt', salt, 'passwordHint', password_hint, 'kdfType', kdf_type, 'kdfIterations', kdf_iterations, 'kdfMemory', kdf_memory, 'kdfParallelism', kdf_parallelism, 'key', akey, 'privateKey', private_key, 'publicKey', public_key)), 'folders', COALESCE(( SELECT jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name)) AS jsonb_agg
           FROM public.folders f
          WHERE (f.user_id = u.id)), '[]'::jsonb), 'items', COALESCE(( SELECT jsonb_agg(((((((c."json" - 'edit'::text) - 'viewPassword'::text) - 'object'::text) - 'organizationUseTotp'::text) - 'collectionIds'::text) || jsonb_build_object('collectionIds', NULL::unknown))) AS jsonb_agg
           FROM public.cipher_details c
          WHERE (c.user_id = u.id)), '[]'::jsonb)) AS export
   FROM public.users u;


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
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: sends sends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sends
    ADD CONSTRAINT sends_pkey PRIMARY KEY (id);


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
-- Name: ciphers_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ciphers_user_id_idx ON public.ciphers USING btree (user_id);


--
-- Name: devices_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX devices_user_id_idx ON public.devices USING btree (user_id);


--
-- Name: folders_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX folders_user_id_idx ON public.folders USING btree (user_id);


--
-- Name: sends_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sends_user_id_idx ON public.sends USING btree (user_id);


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
-- Name: ciphers ciphers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ciphers
    ADD CONSTRAINT ciphers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


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
-- Name: sends sends_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sends
    ADD CONSTRAINT sends_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


