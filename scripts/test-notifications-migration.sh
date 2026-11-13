#!/usr/bin/env bash
set -euo pipefail

export PGHOST="$(printenv PGHOST || echo localhost)"
export PGUSER="$(printenv PGUSER || echo postgres)"
export PGPASSWORD="$(printenv PGPASSWORD || echo postgres)"
export PGDATABASE="$(printenv PGDATABASE || echo postgres)"

psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $function$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $function$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE TYPE public.agent_state AS ENUM (
  'setup_required','active_approval_required','active_autopilot','paused','blocked_integration','attention_required'
);
CREATE TYPE public.post_status AS ENUM (
  'draft','needs_review','approved','scheduled','publishing','published','failed','rejected','canceled','needs_reconciliation'
);
CREATE TYPE public.job_status AS ENUM (
  'queued','running','waiting_for_approval','succeeded','failed_retryable','failed_terminal','canceled','needs_reconciliation'
);
CREATE TYPE public.approval_action AS ENUM ('approved','rejected','revised','auto_approved');
CREATE TYPE public.integration_status AS ENUM ('connected','disconnected','expired','error');
CREATE TYPE public.integration_provider AS ENUM ('linkedin','telegram','polar','mcp');

CREATE TABLE public.profiles (id uuid PRIMARY KEY);
CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES public.profiles(id),
  state public.agent_state NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.content_posts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  status public.post_status NOT NULL,
  internal_title text,
  telegram_job_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.agent_jobs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  status public.job_status NOT NULL,
  job_type text NOT NULL DEFAULT 'other',
  safe_error_message text
);
CREATE TABLE public.approval_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  post_id uuid NOT NULL REFERENCES public.content_posts(id),
  action public.approval_action NOT NULL
);
CREATE TABLE public.integration_connections (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  provider public.integration_provider NOT NULL,
  status public.integration_status NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  status text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
SQL

psql -v ON_ERROR_STOP=1 -f supabase/migrations/0020_durable_notifications.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/0021_telegram_job_failure_notifications.sql

psql -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO public.profiles(id) VALUES ('00000000-0000-0000-0000-000000000001');
INSERT INTO public.workspaces(id,owner_user_id,state)
VALUES ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','active_approval_required');

INSERT INTO public.content_posts(id,workspace_id,status,internal_title)
VALUES ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000010','needs_review','Test review');
UPDATE public.content_posts SET status='published' WHERE id='00000000-0000-0000-0000-000000000020';

INSERT INTO public.agent_jobs(id,workspace_id,status,job_type)
VALUES ('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000010','queued','other');
UPDATE public.agent_jobs SET status='failed_terminal', safe_error_message='A test task failed.' WHERE id='00000000-0000-0000-0000-000000000030';

-- A Telegram job that saved its draft must not be reported as if the draft failed.
INSERT INTO public.agent_jobs(id,workspace_id,status,job_type)
VALUES ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000010','queued','telegram_content_generation');
INSERT INTO public.content_posts(id,workspace_id,status,internal_title,telegram_job_id)
VALUES ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000010','draft','Saved Telegram draft','00000000-0000-0000-0000-000000000031');
UPDATE public.agent_jobs SET status='failed_terminal', safe_error_message='Internal lease failure' WHERE id='00000000-0000-0000-0000-000000000031';

-- A Telegram job that never saved a draft gets a distinct recovery message.
INSERT INTO public.agent_jobs(id,workspace_id,status,job_type)
VALUES ('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000010','queued','telegram_content_generation');
UPDATE public.agent_jobs SET status='failed_terminal', safe_error_message='Internal lease failure' WHERE id='00000000-0000-0000-0000-000000000032';

INSERT INTO public.approval_events(id,workspace_id,post_id,action)
VALUES ('00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020','approved');

INSERT INTO public.integration_connections(id,workspace_id,provider,status)
VALUES ('00000000-0000-0000-0000-000000000050','00000000-0000-0000-0000-000000000010','linkedin','connected');
UPDATE public.integration_connections SET status='expired' WHERE id='00000000-0000-0000-0000-000000000050';

UPDATE public.workspaces SET state='blocked_integration' WHERE id='00000000-0000-0000-0000-000000000010';

INSERT INTO public.subscriptions(id,workspace_id,status)
VALUES ('00000000-0000-0000-0000-000000000060','00000000-0000-0000-0000-000000000010','active');
UPDATE public.subscriptions SET status='past_due' WHERE id='00000000-0000-0000-0000-000000000060';

DO $telegram_notification_test$
DECLARE v_title text; v_body text;
BEGIN
  SELECT title, body INTO v_title, v_body
    FROM public.notification_events
   WHERE event_key = 'job:00000000-0000-0000-0000-000000000031:status:failed_terminal';
  IF v_title <> 'Your draft is saved' OR v_body NOT LIKE '%preview image%' OR (v_body ILIKE '%job lease%' OR v_body ILIKE '%lease expired%') THEN
    RAISE EXCEPTION 'Saved Telegram draft notification is not user-safe: %, %', v_title, v_body;
  END IF;

  SELECT title, body INTO v_title, v_body
    FROM public.notification_events
   WHERE event_key = 'job:00000000-0000-0000-0000-000000000032:status:failed_terminal';
  IF v_title <> 'Your draft could not be created' OR v_body NOT LIKE '%No draft was saved%' OR v_body LIKE '%lease%' THEN
    RAISE EXCEPTION 'Uncreated Telegram draft notification is not user-safe: %, %', v_title, v_body;
  END IF;
END;
$telegram_notification_test$;


DO $notification_count_test$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.notification_events;
  IF v_count <> 9 THEN
    RAISE EXCEPTION 'Expected 9 notification events, got %', v_count;
  END IF;
END;
$notification_count_test$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
DO $$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.notification_events;
  IF v_count <> 9 THEN RAISE EXCEPTION 'Owner cannot read all workspace notifications'; END IF;
  UPDATE public.notification_events SET read_at=now()
  WHERE workspace_id='00000000-0000-0000-0000-000000000010' AND read_at IS NULL;
END;
$$;
RESET ROLE;

DO $$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.claim_pending_notification_deliveries(50);
  IF v_count <> 9 THEN RAISE EXCEPTION 'Expected to claim 9 delivery records, got %', v_count; END IF;
END;
$$;

SELECT 'notification migration and trigger test passed' AS result;
SQL
