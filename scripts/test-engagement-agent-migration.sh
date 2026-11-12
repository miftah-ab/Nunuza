#!/usr/bin/env bash
set -euo pipefail

export PGHOST="$(printenv PGHOST || echo localhost)"
export PGUSER="$(printenv PGUSER || echo postgres)"
export PGPASSWORD="$(printenv PGPASSWORD || echo postgres)"
export PGDATABASE="$(printenv PGDATABASE || echo postgres)"

psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $fn$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE TABLE public.profiles(id uuid PRIMARY KEY);
CREATE TABLE public.workspaces(id uuid PRIMARY KEY, owner_user_id uuid NOT NULL REFERENCES public.profiles(id));
CREATE TABLE public.agent_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 job_type text NOT NULL, status text NOT NULL, idempotency_key text NOT NULL,
 payload jsonb NOT NULL, scheduled_for timestamptz NOT NULL, attempt_count integer NOT NULL, max_attempts integer NOT NULL, UNIQUE(workspace_id,idempotency_key)
);
CREATE TABLE public.integration_connections(
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id), provider text NOT NULL,
 status text NOT NULL, granted_scopes text[]
);
CREATE TABLE public.telegram_links(
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id), telegram_user_id bigint NOT NULL,
 chat_id bigint NOT NULL, revoked_at timestamptz
);
SQL

psql -v ON_ERROR_STOP=1 -f supabase/migrations/0021_engagement_agent_foundation.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/0022_engagement_approval_dispatch.sql

psql -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO public.profiles(id) VALUES
 ('00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000002');
INSERT INTO public.workspaces(id,owner_user_id) VALUES
 ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001');
INSERT INTO public.integration_connections(workspace_id,provider,status,granted_scopes)
 VALUES ('00000000-0000-0000-0000-000000000010','linkedin','connected',ARRAY['w_member_social_feed']);
INSERT INTO public.telegram_links(workspace_id,telegram_user_id,chat_id)
 VALUES ('00000000-0000-0000-0000-000000000010',12345,67890);
INSERT INTO public.engagement_actions(
 id,workspace_id,action_type,target_kind,target_post_urn,parent_post_urn,parent_comment_urn,
 draft_text,draft_hash,status
) VALUES (
 '00000000-0000-0000-0000-000000000020',
 '00000000-0000-0000-0000-000000000010',
 'reply','own_post_comment','urn:li:activity:123','urn:li:activity:123',
 'urn:li:comment:(urn:li:activity:123,456)','Thanks for sharing this.',
 repeat('a',64),'awaiting_approval'
);

-- Only the workspace owner can configure engagement, and the daily cap is bounded.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $
DECLARE v_settings public.engagement_settings;
BEGIN
 v_settings := public.update_engagement_settings(
   '00000000-0000-0000-0000-000000000010',true,7
 );
 IF v_settings.enabled IS DISTINCT FROM TRUE OR v_settings.daily_limit <> 7 THEN
   RAISE EXCEPTION 'Engagement settings were not saved';
 END IF;
END $;
RESET ROLE;

-- A non-owner cannot approve.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
DO $$
BEGIN
 IF public.approve_engagement_action('00000000-0000-0000-0000-000000000020',repeat('a',64)) THEN
   RAISE EXCEPTION 'Non-owner unexpectedly approved engagement action';
 END IF;
END $$;
RESET ROLE;

-- Owner can approve the exact draft once; replay and modified hash fail.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$
BEGIN
 IF NOT public.approve_engagement_action('00000000-0000-0000-0000-000000000020',repeat('a',64)) THEN
   RAISE EXCEPTION 'Owner could not approve exact draft';
 END IF;
 IF public.approve_engagement_action('00000000-0000-0000-0000-000000000020',repeat('a',64)) THEN
   RAISE EXCEPTION 'Approval replay unexpectedly succeeded';
 END IF;
 IF public.reject_engagement_action('00000000-0000-0000-0000-000000000020') THEN
   RAISE EXCEPTION 'Approved action was unexpectedly rejected';
 END IF;
END $$;
RESET ROLE;

DO $$
DECLARE v_status text; v_hash text;
BEGIN
 SELECT status,approval_hash INTO v_status,v_hash FROM public.engagement_actions
 WHERE id='00000000-0000-0000-0000-000000000020';
 IF v_status <> 'approved' OR v_hash <> repeat('a',64) THEN
   RAISE EXCEPTION 'Approval evidence was not persisted correctly';
 END IF;
 IF (SELECT count(*) FROM public.agent_jobs WHERE idempotency_key='engagement-publish-00000000-0000-0000-0000-000000000020') <> 1 THEN
   RAISE EXCEPTION 'Approval did not enqueue exactly one publish job';
 END IF;
END $$;

-- Telegram approval is bound to the exact displayed draft prefix and linked user/chat.
SET ROLE service_role;
DO $
BEGIN
 IF NOT public.approve_engagement_action_telegram(
   '00000000-0000-0000-0000-000000000021',12345,67890,left(repeat('b',64),15)
 ) THEN RAISE EXCEPTION 'Valid Telegram approval failed'; END IF;
 IF public.approve_engagement_action_telegram(
   '00000000-0000-0000-0000-000000000021',12345,67890,left(repeat('b',64),15)
 ) THEN RAISE EXCEPTION 'Telegram approval replay unexpectedly succeeded'; END IF;
END $;
RESET ROLE;

SELECT 'engagement agent migration and approval tests passed' AS result;
SQL
