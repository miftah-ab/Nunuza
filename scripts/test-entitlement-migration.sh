#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:=localhost}"
: "${PGUSER:=postgres}"
: "${PGPASSWORD:=postgres}"
: "${PGDATABASE:=postgres}"
export PGHOST PGUSER PGPASSWORD PGDATABASE

# Minimal schema fixture matching the columns/types touched by migration 0011.
psql -v ON_ERROR_STOP=1 <<'SQL'
CREATE TYPE public.entitlement_type AS ENUM (
  'draft_only', 'internal_test', 'publishing_beta', 'paid_trial',
  'paid_active', 'inactive', 'internal_beta', 'suspended', 'expired'
);
CREATE TYPE public.agent_state AS ENUM (
  'setup_required', 'active_approval_required', 'active_autopilot',
  'paused', 'blocked_integration', 'attention_required'
);
CREATE TYPE public.operating_mode AS ENUM ('approval_required', 'autopilot');
CREATE TYPE public.access_mode AS ENUM ('private_beta', 'commercial');

CREATE TABLE public.workspaces (
  id UUID PRIMARY KEY,
  entitlement_type public.entitlement_type NOT NULL DEFAULT 'draft_only',
  access_mode public.access_mode NOT NULL DEFAULT 'commercial',
  operating_mode public.operating_mode NOT NULL DEFAULT 'approval_required',
  state public.agent_state NOT NULL DEFAULT 'setup_required',
  paused_at TIMESTAMPTZ
);
CREATE TABLE public.subscriptions (
  id BIGSERIAL PRIMARY KEY,
  entitlement_snapshot public.entitlement_type
);

INSERT INTO public.workspaces
  (id, entitlement_type, access_mode, operating_mode, state)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'publishing_beta', 'private_beta', 'autopilot', 'active_autopilot'),
  ('00000000-0000-0000-0000-000000000002', 'internal_test', 'private_beta', 'autopilot', 'active_autopilot'),
  ('00000000-0000-0000-0000-000000000003', 'internal_beta', 'private_beta', 'autopilot', 'active_autopilot'),
  ('00000000-0000-0000-0000-000000000004', 'paid_active', 'commercial', 'approval_required', 'active_approval_required');

INSERT INTO public.subscriptions (entitlement_snapshot)
VALUES ('publishing_beta'), ('internal_test'), ('paid_active');
SQL

psql -v ON_ERROR_STOP=1 -f supabase/migrations/0011_consolidate_beta_entitlements.sql

psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  v_workspace public.workspaces%ROWTYPE;
BEGIN
  SELECT * INTO v_workspace FROM public.workspaces
    WHERE id = '00000000-0000-0000-0000-000000000001';
  IF v_workspace.entitlement_type <> 'internal_beta'
     OR v_workspace.operating_mode <> 'approval_required'
     OR v_workspace.state <> 'active_approval_required'
     OR v_workspace.access_mode <> 'private_beta' THEN
    RAISE EXCEPTION 'publishing_beta was not safely converted to manual-only internal_beta';
  END IF;

  SELECT * INTO v_workspace FROM public.workspaces
    WHERE id = '00000000-0000-0000-0000-000000000002';
  IF v_workspace.entitlement_type <> 'draft_only'
     OR v_workspace.access_mode <> 'commercial'
     OR v_workspace.operating_mode <> 'approval_required'
     OR v_workspace.state <> 'paused'
     OR v_workspace.paused_at IS NULL THEN
    RAISE EXCEPTION 'internal_test was not safely retired to paused draft_only';
  END IF;

  SELECT * INTO v_workspace FROM public.workspaces
    WHERE id = '00000000-0000-0000-0000-000000000003';
  IF v_workspace.entitlement_type <> 'internal_beta'
     OR v_workspace.operating_mode <> 'autopilot'
     OR v_workspace.state <> 'active_autopilot' THEN
    RAISE EXCEPTION 'existing internal_beta workspace was unexpectedly changed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'entitlement_type'
      AND e.enumlabel IN ('publishing_beta', 'internal_test')
  ) THEN
    RAISE EXCEPTION 'retired entitlement labels remain in the new enum';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'entitlement_type_legacy') THEN
    RAISE EXCEPTION 'legacy entitlement enum was not dropped';
  END IF;

  IF (SELECT array_agg(entitlement_snapshot::text ORDER BY id)
      FROM public.subscriptions) <> ARRAY['internal_beta', 'draft_only', 'paid_active'] THEN
    RAISE EXCEPTION 'subscription entitlement snapshots were not migrated correctly';
  END IF;
END;
$$;

SELECT 'entitlement migration test passed' AS result;
SQL
