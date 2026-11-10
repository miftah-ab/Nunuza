#!/usr/bin/env bash
# Tests atomic per-workspace publishing slots and monthly draft usage reservations
# against real PostgreSQL, including concurrent claims.
set -euo pipefail

MIGRATION="supabase/migrations/0010_worker_safety_reservations.sql"
OUT="$(mktemp -d)"
fail() { echo "FAIL: $*" >&2; exit 1; }
q() { psql -v ON_ERROR_STOP=1 -At "$@"; }

PGDATABASE=postgres q -c "DROP DATABASE IF EXISTS workersafetytest" -c "CREATE DATABASE workersafetytest" >/dev/null
export PGDATABASE=workersafetytest

q >/dev/null <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE TYPE post_status AS ENUM (
  'draft','needs_review','approved','scheduled','publishing','published',
  'failed','rejected','canceled','needs_reconciliation'
);
CREATE TABLE public.workspaces (id UUID PRIMARY KEY);
CREATE TABLE public.agent_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  job_type TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE public.content_posts (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  status post_status NOT NULL,
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE public.usage_counters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  metric TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, metric, period_start)
);
SQL

q -f "$MIGRATION" >/dev/null
echo "migration applied"

# The partial unique index is the race-safe guard for overlapping workspace cycles.
CYCLE_WS="10000000-0000-0000-0000-000000000009"
q -c "INSERT INTO workspaces VALUES ('$CYCLE_WS')" >/dev/null
q -c "INSERT INTO agent_jobs(workspace_id,job_type,status) VALUES ('$CYCLE_WS','agent_cycle','queued')" >/dev/null
if q -c "INSERT INTO agent_jobs(workspace_id,job_type,status) VALUES ('$CYCLE_WS','agent_cycle','running')" >/dev/null 2>&1; then
  fail "a workspace must not have overlapping active agent cycles"
fi
q -c "UPDATE agent_jobs SET status='succeeded' WHERE workspace_id='$CYCLE_WS' AND job_type='agent_cycle'" >/dev/null
q -c "INSERT INTO agent_jobs(workspace_id,job_type,status) VALUES ('$CYCLE_WS','agent_cycle','queued')" >/dev/null
echo "ok: active agent cycles are unique per workspace"

WS="10000000-0000-0000-0000-000000000001"
q -c "INSERT INTO workspaces VALUES ('$WS')" >/dev/null
for n in $(seq 1 8); do
  ID=$(printf "20000000-0000-0000-0000-%012d" "$n")
  q -c "INSERT INTO content_posts(id,workspace_id,status) VALUES ('$ID','$WS','approved')" >/dev/null
done

# Eight concurrent publish attempts for one workspace must reserve exactly one slot.
for n in $(seq 1 8); do
  (
    ID=$(printf "20000000-0000-0000-0000-%012d" "$n")
    psql -At -c "SELECT allowed FROM claim_workspace_publish_slot('$WS','$ID')"
  ) > "$OUT/publish-$n.txt" &
done
wait
ALLOWED=$(cat "$OUT"/publish-*.txt | grep -c '^t$' || true)
[ "$ALLOWED" = "1" ] || fail "expected exactly one concurrent publish slot, got $ALLOWED"
PUBLISHING=$(q -c "SELECT count(*) FROM content_posts WHERE workspace_id='$WS' AND status='publishing'")
[ "$PUBLISHING" = "1" ] || fail "expected one post reserved as publishing, got $PUBLISHING"
echo "ok: concurrent publishing claims reserve one daily slot"

# A scheduled post on the same day also reserves the daily slot.
WS2="10000000-0000-0000-0000-000000000002"
q -c "INSERT INTO workspaces VALUES ('$WS2')" >/dev/null
q -c "INSERT INTO content_posts(id,workspace_id,status,scheduled_at) VALUES
('30000000-0000-0000-0000-000000000001','$WS2','scheduled',date_trunc('day',now()) + interval '2 hours'),
('30000000-0000-0000-0000-000000000002','$WS2','approved',NULL)" >/dev/null
DAILY=$(q -c "SELECT allowed FROM claim_workspace_publish_slot('$WS2','30000000-0000-0000-0000-000000000002')")
[ "$DAILY" = "f" ] || fail "scheduled post must reserve the daily slot"
echo "ok: scheduled posts reserve the daily slot"

# Seven published posts in the rolling week block an eighth.
WS3="10000000-0000-0000-0000-000000000003"
q -c "INSERT INTO workspaces VALUES ('$WS3')" >/dev/null
q -c "INSERT INTO content_posts(id,workspace_id,status,published_at,updated_at)
SELECT ('40000000-0000-0000-0000-' || lpad(g::text,12,'0'))::uuid,
       '$WS3','published',now() - (g || ' days')::interval,now() - (g || ' days')::interval
FROM generate_series(0,6) g" >/dev/null
q -c "INSERT INTO content_posts(id,workspace_id,status) VALUES
('40000000-0000-0000-0000-000000000008','$WS3','approved')" >/dev/null
WEEK=$(q -c "SELECT allowed FROM claim_workspace_publish_slot('$WS3','40000000-0000-0000-0000-000000000008')")
[ "$WEEK" = "f" ] || fail "seven posts in rolling week must block eighth"
echo "ok: rolling seven-day cap enforced"

# 80 parallel reservation attempts with a cap of 30 must reserve exactly 30.
WS4="10000000-0000-0000-0000-000000000004"
q -c "INSERT INTO workspaces VALUES ('$WS4')" >/dev/null
for w in $(seq 1 8); do
  (
    for _ in $(seq 1 10); do
      psql -At -c "SELECT reserve_draft_usage('$WS4',current_date,current_date + 30,30)"
    done
  ) > "$OUT/usage-$w.txt" &
done
wait
RESERVED=$(cat "$OUT"/usage-*.txt | grep -c '^t$' || true)
COUNT=$(q -c "SELECT count FROM usage_counters WHERE workspace_id='$WS4' AND metric='draft_items_created'")
[ "$RESERVED" = "30" ] || fail "expected exactly 30 successful usage reservations, got $RESERVED"
[ "$COUNT" = "30" ] || fail "expected usage counter 30, got $COUNT"
q -c "SELECT release_draft_usage('$WS4',current_date)" >/dev/null
NEXT=$(q -c "SELECT reserve_draft_usage('$WS4',current_date,current_date + 30,30)")
[ "$NEXT" = "t" ] || fail "released reservation must allow one new reservation"
echo "ok: monthly draft usage limit is atomic under concurrency"

# Only service_role may call privileged functions.
[ "$(q -c "SELECT has_function_privilege('anon','public.claim_workspace_publish_slot(uuid,uuid)','EXECUTE')")" = "f" ] || fail "anon must not claim publish slots"
[ "$(q -c "SELECT has_function_privilege('authenticated','public.reserve_draft_usage(uuid,date,date,integer)','EXECUTE')")" = "f" ] || fail "authenticated must not reserve usage"
[ "$(q -c "SELECT has_function_privilege('service_role','public.reserve_draft_usage(uuid,date,date,integer)','EXECUTE')")" = "t" ] || fail "service_role must reserve usage"
echo "ok: worker-only execution grants enforced"

echo "ALL WORKER SAFETY CHECKS PASSED"
