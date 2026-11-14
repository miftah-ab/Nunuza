#!/usr/bin/env bash
# Tests atomic publish caps, active cycles, execution leases, and draft quota
# reservations against real PostgreSQL under concurrent workers.
set -euo pipefail

MIGRATION="supabase/migrations/0010_worker_safety_reservations.sql"
LIMIT_MIGRATION="supabase/migrations/20261114082730_configurable_publishing_limits.sql"
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
CREATE TABLE public.workspaces (
  id UUID PRIMARY KEY,
  max_posts_per_day INTEGER NOT NULL DEFAULT 10,
  max_posts_per_7_days INTEGER NOT NULL DEFAULT 50
);
CREATE TABLE public.agent_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lease_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE public.content_posts (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  status post_status NOT NULL,
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  agent_cycle_key TEXT,
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
q -f "$LIMIT_MIGRATION" >/dev/null
echo "worker and configurable publishing-limit migrations applied"

# A workspace may have one active autonomous cycle, but can start another
# after the previous cycle reaches a terminal state.
CYCLE_WS="10000000-0000-0000-0000-000000000009"
q -c "INSERT INTO workspaces(id) VALUES ('$CYCLE_WS')" >/dev/null
q -c "INSERT INTO agent_jobs(workspace_id,job_type,status) VALUES ('$CYCLE_WS','agent_cycle','queued')" >/dev/null
if q -c "INSERT INTO agent_jobs(workspace_id,job_type,status) VALUES ('$CYCLE_WS','agent_cycle','running')" >/dev/null 2>&1; then
  fail "a workspace must not have overlapping active agent cycles"
fi
q -c "UPDATE agent_jobs SET status='succeeded' WHERE workspace_id='$CYCLE_WS' AND job_type='agent_cycle'" >/dev/null
q -c "INSERT INTO agent_jobs(workspace_id,job_type,status) VALUES ('$CYCLE_WS','agent_cycle','queued')" >/dev/null
echo "ok: active agent cycles are unique per workspace"

# Duplicate queue deliveries share the original lease. Only one may renew it.
EXEC_WS="10000000-0000-0000-0000-000000000010"
EXEC_JOB="60000000-0000-0000-0000-000000000001"
q -c "INSERT INTO workspaces(id) VALUES ('$EXEC_WS')" >/dev/null
q -c "INSERT INTO agent_jobs(id,workspace_id,job_type,status,attempt_count,lease_until)
VALUES ('$EXEC_JOB','$EXEC_WS','agent_cycle','running',1,now() + interval '5 minutes')" >/dev/null
EXPECTED_LEASE=$(q -c "SELECT lease_until::text FROM agent_jobs WHERE id='$EXEC_JOB'")
for n in $(seq 1 8); do
  (
    psql -At -c "SELECT begin_agent_job_execution('$EXEC_JOB',1,'$EXPECTED_LEASE',now() + interval '15 minutes')"
  ) > "$OUT/execution-$n.txt" &
done
wait
EXECUTIONS=$(cat "$OUT"/execution-*.txt | grep -c '^t$' || true)
[ "$EXECUTIONS" = "1" ] || fail "expected one execution lease owner, got $EXECUTIONS"
echo "ok: duplicate queue deliveries cannot start the same attempt twice"

WS="10000000-0000-0000-0000-000000000001"
q -c "INSERT INTO workspaces(id,max_posts_per_day,max_posts_per_7_days) VALUES ('$WS',1,7)" >/dev/null
for n in $(seq 1 8); do
  ID=$(printf "20000000-0000-0000-0000-%012d" "$n")
  q -c "INSERT INTO content_posts(id,workspace_id,status) VALUES ('$ID','$WS','approved')" >/dev/null
done

# Eight concurrent publish attempts for one workspace must reserve one slot.
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
q -c "INSERT INTO workspaces(id,max_posts_per_day,max_posts_per_7_days) VALUES ('$WS2',1,7)" >/dev/null
q -c "INSERT INTO content_posts(id,workspace_id,status,scheduled_at) VALUES
('30000000-0000-0000-0000-000000000001','$WS2','scheduled',date_trunc('day',now()) + interval '2 hours'),
('30000000-0000-0000-0000-000000000002','$WS2','approved',NULL)" >/dev/null
DAILY=$(q -c "SELECT allowed FROM claim_workspace_publish_slot('$WS2','30000000-0000-0000-0000-000000000002')")
[ "$DAILY" = "f" ] || fail "scheduled post must reserve the daily slot"
echo "ok: scheduled posts reserve the daily slot"

# Ten published posts in the rolling week block the eleventh.
WS3="10000000-0000-0000-0000-000000000003"
q -c "INSERT INTO workspaces(id,max_posts_per_day,max_posts_per_7_days) VALUES ('$WS3',10,10)" >/dev/null
q -c "INSERT INTO content_posts(id,workspace_id,status,published_at,updated_at)
SELECT ('40000000-0000-0000-0000-' || lpad(g::text,12,'0'))::uuid,
       '$WS3','published',now() - (g * interval '12 hours'),now() - (g * interval '12 hours')
FROM generate_series(0,9) g" >/dev/null
q -c "INSERT INTO content_posts(id,workspace_id,status) VALUES
('40000000-0000-0000-0000-000000000011','$WS3','approved')" >/dev/null
WEEK=$(q -c "SELECT allowed FROM claim_workspace_publish_slot('$WS3','40000000-0000-0000-0000-000000000011')")
[ "$WEEK" = "f" ] || fail "ten posts in rolling week must block eleventh"
echo "ok: rolling seven-day cap enforced"

# The migration defaults every existing and new workspace to 10/day and 50/7 days.
DEFAULT_WS="10000000-0000-0000-0000-000000000005"
q -c "INSERT INTO workspaces(id) VALUES ('$DEFAULT_WS')" >/dev/null
DEFAULT_LIMITS=$(q -c "SELECT max_posts_per_day::text || ':' || max_posts_per_7_days::text FROM workspaces WHERE id='$DEFAULT_WS'")
[ "$DEFAULT_LIMITS" = "10:50" ] || fail "expected workspace publishing defaults 10:50, got $DEFAULT_LIMITS"
echo "ok: configurable publishing defaults are 10/day and 50/7 days"

# 80 distinct jobs race for a monthly cap of 30. Repeating one job's reservation
# is idempotent and does not consume another slot.
WS4="10000000-0000-0000-0000-000000000004"
q -c "INSERT INTO workspaces(id) VALUES ('$WS4')" >/dev/null
for n in $(seq 1 80); do
  ID=$(printf "50000000-0000-0000-0000-%012d" "$n")
  q -c "INSERT INTO agent_jobs(id,workspace_id,job_type,status) VALUES ('$ID','$WS4','usage_reservation_test','queued')" >/dev/null
done
for w in $(seq 1 8); do
  (
    for n in $(seq 1 10); do
      INDEX=$(( (w - 1) * 10 + n ))
      ID=$(printf "50000000-0000-0000-0000-%012d" "$INDEX")
      psql -At -c "SELECT reserve_draft_usage('$ID','$WS4',current_date,current_date + 30,30)"
    done
  ) > "$OUT/usage-$w.txt" &
done
wait
RESERVED=$(cat "$OUT"/usage-*.txt | grep -c '^t$' || true)
COUNT=$(q -c "SELECT count FROM usage_counters WHERE workspace_id='$WS4' AND metric='draft_items_created'")
[ "$RESERVED" = "30" ] || fail "expected exactly 30 successful usage reservations, got $RESERVED"
[ "$COUNT" = "30" ] || fail "expected usage counter 30, got $COUNT"
SAME=$(q -c "SELECT reserve_draft_usage('50000000-0000-0000-0000-000000000001','$WS4',current_date,current_date + 30,30)")
[ "$SAME" = "t" ] || fail "retrying the same job reservation must remain successful"
COUNT_AFTER_RETRY=$(q -c "SELECT count FROM usage_counters WHERE workspace_id='$WS4' AND metric='draft_items_created'")
[ "$COUNT_AFTER_RETRY" = "30" ] || fail "same-job retry must not increment usage twice"
q -c "UPDATE agent_jobs SET status='failed_terminal' WHERE id='50000000-0000-0000-0000-000000000001'" >/dev/null
COUNT_AFTER_TERMINAL=$(q -c "SELECT count FROM usage_counters WHERE workspace_id='$WS4' AND metric='draft_items_created'")
[ "$COUNT_AFTER_TERMINAL" = "29" ] || fail "terminal job must release its unused draft reservation"
q -c "INSERT INTO agent_jobs(id,workspace_id,job_type,status) VALUES ('50000000-0000-0000-0000-000000000081','$WS4','usage_reservation_test','queued')" >/dev/null
NEXT=$(q -c "SELECT reserve_draft_usage('50000000-0000-0000-0000-000000000081','$WS4',current_date,current_date + 30,30)")
[ "$NEXT" = "t" ] || fail "released reservation must allow one new reservation"
echo "ok: monthly draft usage is atomic and retry-idempotent"

# Only service_role may call privileged functions.
[ "$(q -c "SELECT has_function_privilege('anon','public.claim_workspace_publish_slot(uuid,uuid)','EXECUTE')")" = "f" ] || fail "anon must not claim publish slots"
[ "$(q -c "SELECT has_function_privilege('authenticated','public.reserve_draft_usage(uuid,uuid,date,date,integer)','EXECUTE')")" = "f" ] || fail "authenticated must not reserve usage"
[ "$(q -c "SELECT has_function_privilege('service_role','public.reserve_draft_usage(uuid,uuid,date,date,integer)','EXECUTE')")" = "t" ] || fail "service_role must reserve usage"
[ "$(q -c "SELECT has_function_privilege('anon','public.begin_agent_job_execution(uuid,integer,timestamptz,timestamptz)','EXECUTE')")" = "f" ] || fail "anon must not begin job execution"
[ "$(q -c "SELECT has_function_privilege('service_role','public.begin_agent_job_execution(uuid,integer,timestamptz,timestamptz)','EXECUTE')")" = "t" ] || fail "service_role must begin job execution"
echo "ok: worker-only execution grants enforced"

echo "ALL WORKER SAFETY CHECKS PASSED"
