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
-- Name: cipher_details; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.cipher_details AS
 SELECT id,
    user_id,
    folder_id,
    deleted_at,
    (data || jsonb_build_object('id', id, 'organizationId', NULL::unknown, 'folderId', folder_id, 'type', type, 'favorite', favorite, 'reprompt', reprompt, 'edit', true, 'viewPassword', true, 'collectionIds', jsonb_build_array(), 'creationDate', public.bw_timestamp(created_at), 'revisionDate', public.bw_timestamp(revision_date), 'deletedDate',
        CASE
            WHEN (deleted_at IS NULL) THEN NULL::jsonb
            ELSE to_jsonb(public.bw_timestamp(deleted_at))
        END, 'object', 'cipherDetails')) AS "json"
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
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email public.citext NOT NULL,
    name text,
    password_hash text NOT NULL,
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
    revision_date timestamp with time zone DEFAULT now() NOT NULL
);


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
-- PostgreSQL database dump complete
--


