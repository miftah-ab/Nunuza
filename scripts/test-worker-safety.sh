#!/usr/bin/env bash
# Tests atomic publish caps, active cycles, execution leases, and draft quota
# reservations against real PostgreSQL under concurrent workers.
set -euo pipefail

MIGRATION="supabase/migrations/0010_worker_safety_reservations.sql"
LIMIT_MIGRATION="supabase/migrations/20261114082730_configurable_publishing_limits.sql"
CANCEL_MIGRATION="supabase/migrations/20261115054533_atomic_scheduled_post_cancel.sql"
SCHEDULE_MIGRATION="supabase/migrations/20261115054544_atomic_scheduling_and_product_caps.sql"
DRAFT_USAGE_MIGRATION="supabase/migrations/20261115054539_atomic_draft_usage.sql"
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
CREATE TABLE public.profiles (id UUID PRIMARY KEY);
CREATE TABLE public.workspaces (
  id UUID PRIMARY KEY,
  owner_user_id UUID,
  entitlement_type TEXT NOT NULL DEFAULT 'paid_active',
  paused_at TIMESTAMPTZ,
  max_posts_per_day INTEGER NOT NULL DEFAULT 10,
  max_posts_per_7_days INTEGER NOT NULL DEFAULT 50
);
CREATE TABLE public.agent_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL DEFAULT gen_random_uuid()::TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  lease_until TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  last_error_code TEXT,
  safe_error_message TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, idempotency_key)
);
CREATE TABLE public.content_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  created_by UUID,
  text TEXT NOT NULL DEFAULT '',
  internal_title TEXT,
  pillar TEXT,
  source_notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status post_status NOT NULL,
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  agent_cycle_key TEXT,
  telegram_job_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE public.content_post_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  post_id UUID NOT NULL REFERENCES public.content_posts(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  text TEXT NOT NULL,
  change_source TEXT NOT NULL,
  changed_by UUID,
  UNIQUE(post_id, version_number)
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
q -f "$CANCEL_MIGRATION" >/dev/null
q -f "$DRAFT_USAGE_MIGRATION" >/dev/null
q -f "$SCHEDULE_MIGRATION" >/dev/null
echo "worker, publishing-limit, cancellation, draft-usage, and atomic-scheduling migrations applied"

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

# Seven published posts in the rolling week block the eighth.
WS3="10000000-0000-0000-0000-000000000003"
q -c "INSERT INTO workspaces(id,max_posts_per_day,max_posts_per_7_days) VALUES ('$WS3',1,7)" >/dev/null
q -c "INSERT INTO content_posts(id,workspace_id,status,published_at,updated_at)
SELECT ('40000000-0000-0000-0000-' || lpad(g::text,12,'0'))::uuid,
       '$WS3','published',now() - (g * interval '23 hours'),now() - (g * interval '24 hours')
FROM generate_series(1,7) g" >/dev/null
q -c "INSERT INTO content_posts(id,workspace_id,status) VALUES
('40000000-0000-0000-0000-000000000011','$WS3','approved')" >/dev/null
WEEK=$(q -c "SELECT allowed FROM claim_workspace_publish_slot('$WS3','40000000-0000-0000-0000-000000000011')")
[ "$WEEK" = "f" ] || fail "seven posts in rolling week must block eighth"
echo "ok: rolling seven-day cap enforced"

# Cancellation must atomically win against a queued job and reset its post.
CANCEL_WS="10000000-0000-0000-0000-000000000021"
CANCEL_POST="30000000-0000-0000-0000-000000000021"
CANCEL_JOB="60000000-0000-0000-0000-000000000021"
q -c "INSERT INTO workspaces(id) VALUES ('$CANCEL_WS')" >/dev/null
q -c "INSERT INTO content_posts(id,workspace_id,status,scheduled_at)
VALUES ('$CANCEL_POST','$CANCEL_WS','scheduled',now() + interval '1 day')" >/dev/null
q -c "INSERT INTO agent_jobs(id,workspace_id,job_type,status,idempotency_key,scheduled_for)
VALUES ('$CANCEL_JOB','$CANCEL_WS','publish_post','queued','publish-$CANCEL_WS-$CANCEL_POST',now())" >/dev/null
CANCELED=$(q -c "SELECT success FROM cancel_scheduled_post_atomic('$CANCEL_WS','$CANCEL_POST')")
[ "$CANCELED" = "t" ] || fail "queued scheduled post should cancel atomically"
[ "$(q -c "SELECT status FROM agent_jobs WHERE id='$CANCEL_JOB'")" = "canceled" ] || fail "cancel must stop the queued publishing job"
[ "$(q -c "SELECT status::TEXT || ':' || (scheduled_at IS NULL)::TEXT FROM content_posts WHERE id='$CANCEL_POST'")" = "approved:true" ] || fail "cancel must reset the post only after canceling its job"
echo "ok: queued job cancellation and post reset commit together"

# A running job belongs to the worker; cancellation must not make its post eligible.
RUNNING_WS="10000000-0000-0000-0000-000000000022"
RUNNING_POST="30000000-0000-0000-0000-000000000022"
RUNNING_JOB="60000000-0000-0000-0000-000000000022"
q -c "INSERT INTO workspaces(id) VALUES ('$RUNNING_WS')" >/dev/null
q -c "INSERT INTO content_posts(id,workspace_id,status,scheduled_at)
VALUES ('$RUNNING_POST','$RUNNING_WS','scheduled',now() + interval '1 day')" >/dev/null
q -c "INSERT INTO agent_jobs(id,workspace_id,job_type,status,idempotency_key,scheduled_for)
VALUES ('$RUNNING_JOB','$RUNNING_WS','publish_post','running','publish-$RUNNING_WS-$RUNNING_POST',now())" >/dev/null
RUNNING_CANCEL=$(q -c "SELECT success FROM cancel_scheduled_post_atomic('$RUNNING_WS','$RUNNING_POST')")
[ "$RUNNING_CANCEL" = "f" ] || fail "running job must not be canceled by user path"
[ "$(q -c "SELECT status FROM agent_jobs WHERE id='$RUNNING_JOB'")" = "running" ] || fail "running job state must remain unchanged"
[ "$(q -c "SELECT status FROM content_posts WHERE id='$RUNNING_POST'")" = "scheduled" ] || fail "running job post must remain scheduled, never approved"
echo "ok: cancellation refuses jobs already claimed by a worker"

# Ambiguous publication is human-reconciliation-only and must never be reset.
RECON_WS="10000000-0000-0000-0000-000000000023"
RECON_POST="30000000-0000-0000-0000-000000000023"
RECON_JOB="60000000-0000-0000-0000-000000000023"
q -c "INSERT INTO workspaces(id) VALUES ('$RECON_WS')" >/dev/null
q -c "INSERT INTO content_posts(id,workspace_id,status,scheduled_at)
VALUES ('$RECON_POST','$RECON_WS','scheduled',now() + interval '1 day')" >/dev/null
q -c "INSERT INTO agent_jobs(id,workspace_id,job_type,status,idempotency_key,scheduled_for)
VALUES ('$RECON_JOB','$RECON_WS','publish_post','needs_reconciliation','publish-$RECON_WS-$RECON_POST',now())" >/dev/null
RECON_CANCEL=$(q -c "SELECT success FROM cancel_scheduled_post_atomic('$RECON_WS','$RECON_POST')")
[ "$RECON_CANCEL" = "f" ] || fail "needs_reconciliation job must not be canceled automatically"
[ "$(q -c "SELECT status FROM content_posts WHERE id='$RECON_POST'")" = "scheduled" ] || fail "reconciliation post must not become publishable again"
echo "ok: ambiguous publication cannot be silently re-queued"

# Race a worker claim against cancellation. The only valid outcomes are:
# worker wins => running/scheduled; cancellation wins => canceled/approved.
RACE_WS="10000000-0000-0000-0000-000000000024"
RACE_POST="30000000-0000-0000-0000-000000000024"
RACE_JOB="60000000-0000-0000-0000-000000000024"
q -c "INSERT INTO workspaces(id) VALUES ('$RACE_WS')" >/dev/null
q -c "INSERT INTO content_posts(id,workspace_id,status,scheduled_at)
VALUES ('$RACE_POST','$RACE_WS','scheduled',now() + interval '1 day')" >/dev/null
q -c "INSERT INTO agent_jobs(id,workspace_id,job_type,status,idempotency_key,scheduled_for)
VALUES ('$RACE_JOB','$RACE_WS','publish_post','queued','publish-$RACE_WS-$RACE_POST',now())" >/dev/null
(
  psql -v ON_ERROR_STOP=1 -At <<SQL
BEGIN;
UPDATE agent_jobs SET status='running' WHERE id='$RACE_JOB' AND status='queued';
SELECT pg_sleep(0.2);
COMMIT;
SQL
) > "$OUT/cancel-race-claim.txt" &
(
  sleep 0.05
  psql -v ON_ERROR_STOP=1 -At -c "SELECT success FROM cancel_scheduled_post_atomic('$RACE_WS','$RACE_POST')"
) > "$OUT/cancel-race-cancel.txt" &
wait
RACE_STATE=$(q -c "SELECT j.status || ':' || p.status FROM agent_jobs j JOIN content_posts p ON p.id='$RACE_POST' WHERE j.id='$RACE_JOB'")
case "$RACE_STATE" in
  "running:scheduled"|"canceled:approved") ;;
  *) fail "worker/cancel race reached unsafe state: $RACE_STATE" ;;
esac
echo "ok: worker claim and cancellation serialize without a publish-after-cancel state"

# Scheduling is one transaction: a valid request creates the durable job and
# changes the post to scheduled together.
SCHEDULE_WS="10000000-0000-0000-0000-000000000041"
SCHEDULE_OWNER="70000000-0000-0000-0000-000000000041"
SCHEDULE_POST="30000000-0000-0000-0000-000000000041"
SCHEDULE_KEY="publish-$SCHEDULE_WS-$SCHEDULE_POST"
SCHEDULE_TIME=$(date -u -d '+2 days' '+%Y-%m-%dT12:00:00Z')
q -c "INSERT INTO workspaces(id,owner_user_id,max_posts_per_day,max_posts_per_7_days) VALUES ('$SCHEDULE_WS','$SCHEDULE_OWNER',1,7)" >/dev/null
q -c "INSERT INTO content_posts(id,workspace_id,status) VALUES ('$SCHEDULE_POST','$SCHEDULE_WS','approved')" >/dev/null
SCHEDULE_RESULT=$(q -c "SELECT schedule_post_atomic('$SCHEDULE_WS','$SCHEDULE_POST','$SCHEDULE_OWNER','$SCHEDULE_TIME'::timestamptz)->>'success'")
[ "$SCHEDULE_RESULT" = "true" ] || fail "valid schedule request should atomically succeed"
[ "$(q -c "SELECT status FROM content_posts WHERE id='$SCHEDULE_POST'")" = "scheduled" ] || fail "atomic schedule must update post status"
[ "$(q -c "SELECT status FROM agent_jobs WHERE workspace_id='$SCHEDULE_WS' AND idempotency_key='$SCHEDULE_KEY'")" = "queued" ] || fail "atomic schedule must create a queued publish job"
SCHEDULE_JOB_ID=$(q -c "SELECT id FROM agent_jobs WHERE workspace_id='$SCHEDULE_WS' AND idempotency_key='$SCHEDULE_KEY'")
echo "ok: schedule job and post status commit together"

# Cancellation followed by a deliberate reschedule reuses the same stable job.
q -c "SELECT success FROM cancel_scheduled_post_atomic('$SCHEDULE_WS','$SCHEDULE_POST')" >/dev/null
RESCHEDULE_RESULT=$(q -c "SELECT schedule_post_atomic('$SCHEDULE_WS','$SCHEDULE_POST','$SCHEDULE_OWNER',('$SCHEDULE_TIME'::timestamptz + interval '1 hour'))->>'success'")
[ "$RESCHEDULE_RESULT" = "true" ] || fail "canceled job should be safely reschedulable"
[ "$(q -c "SELECT count(*) FROM agent_jobs WHERE workspace_id='$SCHEDULE_WS' AND idempotency_key='$SCHEDULE_KEY'")" = "1" ] || fail "reschedule must reuse one idempotent job"
[ "$(q -c "SELECT id FROM agent_jobs WHERE workspace_id='$SCHEDULE_WS' AND idempotency_key='$SCHEDULE_KEY'")" = "$SCHEDULE_JOB_ID" ] || fail "reschedule must preserve the original job ID"
echo "ok: explicit reschedule reuses a canceled job without duplicates"

# A needs_reconciliation job must never be re-queued.
RECON_SCHEDULE_WS="10000000-0000-0000-0000-000000000042"
RECON_SCHEDULE_OWNER="70000000-0000-0000-0000-000000000042"
RECON_SCHEDULE_POST="30000000-0000-0000-0000-000000000042"
q -c "INSERT INTO workspaces(id,owner_user_id) VALUES ('$RECON_SCHEDULE_WS','$RECON_SCHEDULE_OWNER')" >/dev/null
q -c "INSERT INTO content_posts(id,workspace_id,status) VALUES ('$RECON_SCHEDULE_POST','$RECON_SCHEDULE_WS','approved')" >/dev/null
q -c "INSERT INTO agent_jobs(workspace_id,job_type,status,idempotency_key) VALUES ('$RECON_SCHEDULE_WS','publish_post','needs_reconciliation','publish-$RECON_SCHEDULE_WS-$RECON_SCHEDULE_POST')" >/dev/null
RECON_SCHEDULE_RESULT=$(q -c "SELECT schedule_post_atomic('$RECON_SCHEDULE_WS','$RECON_SCHEDULE_POST','$RECON_SCHEDULE_OWNER','$SCHEDULE_TIME'::timestamptz)->>'reason'")
[ "$RECON_SCHEDULE_RESULT" = "JOB_STATE_NOT_RESCHEDULABLE" ] || fail "needs_reconciliation job must not be re-queued"
[ "$(q -c "SELECT status FROM content_posts WHERE id='$RECON_SCHEDULE_POST'")" = "approved" ] || fail "failed schedule attempt must not change the post"
echo "ok: schedule path refuses ambiguous publishing jobs"

# Daily and rolling seven-day caps include posts on either side of the target.
DAILY_WS="10000000-0000-0000-0000-000000000043"
DAILY_OWNER="70000000-0000-0000-0000-000000000043"
DAILY_POST="30000000-0000-0000-0000-000000000043"
DAILY_EXISTING="30000000-0000-0000-0000-000000000044"
DAILY_TIME=$(date -u -d '+3 days' '+%Y-%m-%dT12:00:00Z')
q -c "INSERT INTO workspaces(id,owner_user_id) VALUES ('$DAILY_WS','$DAILY_OWNER')" >/dev/null
q -c "INSERT INTO content_posts(id,workspace_id,status,scheduled_at) VALUES ('$DAILY_EXISTING','$DAILY_WS','scheduled','$DAILY_TIME')" >/dev/null
q -c "INSERT INTO content_posts(id,workspace_id,status) VALUES ('$DAILY_POST','$DAILY_WS','approved')" >/dev/null
DAILY_RESULT=$(q -c "SELECT schedule_post_atomic('$DAILY_WS','$DAILY_POST','$DAILY_OWNER','$DAILY_TIME'::timestamptz)->>'reason'")
[ "$DAILY_RESULT" = "DAILY_CAP_REACHED" ] || fail "second post on the same UTC day must be blocked"
echo "ok: atomic scheduler enforces one post per UTC calendar day"

WEEK_WS="10000000-0000-0000-0000-000000000045"
WEEK_OWNER="70000000-0000-0000-0000-000000000045"
WEEK_POST="30000000-0000-0000-0000-000000000045"
WEEK_TIME=$(date -u -d '+14 days' '+%Y-%m-%dT12:00:00Z')
q -c "INSERT INTO workspaces(id,owner_user_id) VALUES ('$WEEK_WS','$WEEK_OWNER')" >/dev/null
for n in $(seq 1 6); do
  EXISTING_ID=$(printf "30000000-0000-0000-0000-%012d" "$((100+n))")
  EXISTING_TIME=$(date -u -d "$WEEK_TIME - $n days" '+%Y-%m-%dT12:00:00Z')
  q -c "INSERT INTO content_posts(id,workspace_id,status,scheduled_at) VALUES ('$EXISTING_ID','$WEEK_WS','scheduled','$EXISTING_TIME')" >/dev/null
done
WEEK_FUTURE_ID="30000000-0000-0000-0000-000000000107"
WEEK_FUTURE_TIME=$(date -u -d "$WEEK_TIME + 1 day" '+%Y-%m-%dT12:00:00Z')
q -c "INSERT INTO content_posts(id,workspace_id,status,scheduled_at) VALUES ('$WEEK_FUTURE_ID','$WEEK_WS','scheduled','$WEEK_FUTURE_TIME')" >/dev/null
q -c "INSERT INTO content_posts(id,workspace_id,status) VALUES ('$WEEK_POST','$WEEK_WS','approved')" >/dev/null
WEEK_RESULT=$(q -c "SELECT schedule_post_atomic('$WEEK_WS','$WEEK_POST','$WEEK_OWNER','$WEEK_TIME'::timestamptz)->>'reason'")
[ "$WEEK_RESULT" = "WEEKLY_CAP_REACHED" ] || fail "eighth post in a rolling seven-day window must be blocked"
echo "ok: atomic scheduler enforces seven posts in every rolling seven-day window"

# Concurrent requests for the same day serialize on the workspace row.
RACE_SCHEDULE_WS="10000000-0000-0000-0000-000000000046"
RACE_SCHEDULE_OWNER="70000000-0000-0000-0000-000000000046"
RACE_SCHEDULE_TIME=$(date -u -d '+20 days' '+%Y-%m-%dT12:00:00Z')
q -c "INSERT INTO workspaces(id,owner_user_id) VALUES ('$RACE_SCHEDULE_WS','$RACE_SCHEDULE_OWNER')" >/dev/null
for n in 1 2; do
  POST_ID=$(printf "30000000-0000-0000-0000-%012d" "$((200+n))")
  q -c "INSERT INTO content_posts(id,workspace_id,status) VALUES ('$POST_ID','$RACE_SCHEDULE_WS','approved')" >/dev/null
  (
    psql -At -c "SELECT schedule_post_atomic('$RACE_SCHEDULE_WS','$POST_ID','$RACE_SCHEDULE_OWNER','$RACE_SCHEDULE_TIME'::timestamptz)->>'success'"
  ) > "$OUT/schedule-race-$n.txt" &
done
wait
RACE_SCHEDULE_ALLOWED=$(cat "$OUT"/schedule-race-*.txt | grep -c '^true$' || true)
[ "$RACE_SCHEDULE_ALLOWED" = "1" ] || fail "concurrent schedule calls must allow only one post for the same UTC day"
[ "$(q -c "SELECT count(*) FROM content_posts WHERE workspace_id='$RACE_SCHEDULE_WS' AND status='scheduled'")" = "1" ] || fail "concurrent schedule race must leave one scheduled post"
echo "ok: concurrent schedule requests cannot exceed daily cap"

# The database cannot be configured above product limits.
if q -c "UPDATE workspaces SET max_posts_per_day=2 WHERE id='$SCHEDULE_WS'" >/dev/null 2>&1; then
  fail "workspace daily cap must not exceed product maximum 1"
fi
if q -c "UPDATE workspaces SET max_posts_per_7_days=8 WHERE id='$SCHEDULE_WS'" >/dev/null 2>&1; then
  fail "workspace weekly cap must not exceed product maximum 7"
fi
echo "ok: database constraints prevent raising product publishing caps"

# The atomic scheduling RPC enforces owner, entitlement, and pause gates
# independently of the application-layer checks.
DRAFT_SCHEDULE_WS="10000000-0000-0000-0000-000000000047"
DRAFT_SCHEDULE_OWNER="70000000-0000-0000-0000-000000000047"
DRAFT_SCHEDULE_POST="30000000-0000-0000-0000-000000000047"
q -c "INSERT INTO workspaces(id,owner_user_id,entitlement_type) VALUES ('$DRAFT_SCHEDULE_WS','$DRAFT_SCHEDULE_OWNER','draft_only')" >/dev/null
q -c "INSERT INTO content_posts(id,workspace_id,status) VALUES ('$DRAFT_SCHEDULE_POST','$DRAFT_SCHEDULE_WS','approved')" >/dev/null
DRAFT_SCHEDULE_RESULT=$(q -c "SELECT schedule_post_atomic('$DRAFT_SCHEDULE_WS','$DRAFT_SCHEDULE_POST','$DRAFT_SCHEDULE_OWNER','$SCHEDULE_TIME'::timestamptz)->>'reason'")
[ "$DRAFT_SCHEDULE_RESULT" = "ENTITLEMENT_REQUIRED" ] || fail "draft_only workspace must not schedule"

PAUSED_SCHEDULE_WS="10000000-0000-0000-0000-000000000048"
PAUSED_SCHEDULE_OWNER="70000000-0000-0000-0000-000000000048"
PAUSED_SCHEDULE_POST="30000000-0000-0000-0000-000000000048"
q -c "INSERT INTO workspaces(id,owner_user_id,paused_at) VALUES ('$PAUSED_SCHEDULE_WS','$PAUSED_SCHEDULE_OWNER',now())" >/dev/null
q -c "INSERT INTO content_posts(id,workspace_id,status) VALUES ('$PAUSED_SCHEDULE_POST','$PAUSED_SCHEDULE_WS','approved')" >/dev/null
PAUSED_SCHEDULE_RESULT=$(q -c "SELECT schedule_post_atomic('$PAUSED_SCHEDULE_WS','$PAUSED_SCHEDULE_POST','$PAUSED_SCHEDULE_OWNER','$SCHEDULE_TIME'::timestamptz)->>'reason'")
[ "$PAUSED_SCHEDULE_RESULT" = "WORKSPACE_PAUSED" ] || fail "paused workspace must not schedule"

OWNER_SCHEDULE_RESULT=$(q -c "SELECT schedule_post_atomic('$SCHEDULE_WS','$SCHEDULE_POST','70000000-0000-0000-0000-000000000099','$SCHEDULE_TIME'::timestamptz)->>'reason'")
[ "$OWNER_SCHEDULE_RESULT" = "WORKSPACE_ACCESS_DENIED" ] || fail "non-owner must not schedule a workspace post"
echo "ok: database scheduling RPC enforces owner, entitlement, and pause gates"

# Worker claims must re-check the live workspace gates and the workspace's
# selected lower caps; they must not rely only on the scheduler's earlier check.
CLAIM_PAUSED_WS="10000000-0000-0000-0000-000000000049"
CLAIM_PAUSED_OWNER="70000000-0000-0000-0000-000000000049"
CLAIM_PAUSED_POST="30000000-0000-0000-0000-000000000049"
q -c "INSERT INTO workspaces(id,owner_user_id,paused_at) VALUES ('$CLAIM_PAUSED_WS','$CLAIM_PAUSED_OWNER',now())" >/dev/null
q -c "INSERT INTO content_posts(id,workspace_id,status) VALUES ('$CLAIM_PAUSED_POST','$CLAIM_PAUSED_WS','approved')" >/dev/null
[ "$(q -c "SELECT reason FROM claim_workspace_publish_slot('$CLAIM_PAUSED_WS','$CLAIM_PAUSED_POST')")" = "WORKSPACE_PAUSED" ] || fail "worker must refuse a paused workspace"

CLAIM_DRAFT_WS="10000000-0000-0000-0000-000000000050"
CLAIM_DRAFT_OWNER="70000000-0000-0000-0000-000000000050"
CLAIM_DRAFT_POST="30000000-0000-0000-0000-000000000050"
q -c "INSERT INTO workspaces(id,owner_user_id,entitlement_type) VALUES ('$CLAIM_DRAFT_WS','$CLAIM_DRAFT_OWNER','draft_only')" >/dev/null
q -c "INSERT INTO content_posts(id,workspace_id,status) VALUES ('$CLAIM_DRAFT_POST','$CLAIM_DRAFT_WS','approved')" >/dev/null
[ "$(q -c "SELECT reason FROM claim_workspace_publish_slot('$CLAIM_DRAFT_WS','$CLAIM_DRAFT_POST')")" = "ENTITLEMENT_REQUIRED" ] || fail "worker must refuse a draft-only workspace"

CLAIM_LOWER_WS="10000000-0000-0000-0000-000000000051"
CLAIM_LOWER_OWNER="70000000-0000-0000-0000-000000000051"
CLAIM_LOWER_POST="30000000-0000-0000-0000-000000000051"
q -c "INSERT INTO workspaces(id,owner_user_id,max_posts_per_day,max_posts_per_7_days) VALUES ('$CLAIM_LOWER_WS','$CLAIM_LOWER_OWNER',0,0)" >/dev/null
q -c "INSERT INTO content_posts(id,workspace_id,status) VALUES ('$CLAIM_LOWER_POST','$CLAIM_LOWER_WS','approved')" >/dev/null
[ "$(q -c "SELECT reason FROM claim_workspace_publish_slot('$CLAIM_LOWER_WS','$CLAIM_LOWER_POST')")" = "DAILY_CAP_REACHED" ] || fail "worker must enforce a workspace-selected zero daily limit"

CLAIM_NOT_DUE_WS="10000000-0000-0000-0000-000000000052"
CLAIM_NOT_DUE_OWNER="70000000-0000-0000-0000-000000000052"
CLAIM_NOT_DUE_POST="30000000-0000-0000-0000-000000000052"
q -c "INSERT INTO workspaces(id,owner_user_id) VALUES ('$CLAIM_NOT_DUE_WS','$CLAIM_NOT_DUE_OWNER')" >/dev/null
q -c "INSERT INTO content_posts(id,workspace_id,status,scheduled_at) VALUES ('$CLAIM_NOT_DUE_POST','$CLAIM_NOT_DUE_WS','scheduled',now()+interval '1 day')" >/dev/null
[ "$(q -c "SELECT reason FROM claim_workspace_publish_slot('$CLAIM_NOT_DUE_WS','$CLAIM_NOT_DUE_POST')")" = "POST_NOT_DUE" ] || fail "worker must not publish a scheduled post early"
echo "ok: publish worker re-checks entitlement, pause, lower caps, and due time"

# Only service_role may call privileged functions.
# The migration defaults every existing and new workspace to the product ceiling of 1/day and 7/7 days.
DEFAULT_WS="10000000-0000-0000-0000-000000000005"
q -c "INSERT INTO workspaces(id) VALUES ('$DEFAULT_WS')" >/dev/null
DEFAULT_LIMITS=$(q -c "SELECT max_posts_per_day::text || ':' || max_posts_per_7_days::text FROM workspaces WHERE id='$DEFAULT_WS'")
[ "$DEFAULT_LIMITS" = "1:7" ] || fail "expected product publishing defaults 1:7, got $DEFAULT_LIMITS"
echo "ok: product publishing defaults are 1/day and 7/7 days"

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

# Background jobs must reserve and release against the same paid billing
# period metric, not the no-subscription calendar-month counter.
PAID_JOB="50000000-0000-0000-0000-000000000082"
PAID_JOB_METRIC="draft_items_created@2026-11-14T12:00:00.000Z"
q -c "INSERT INTO agent_jobs(id,workspace_id,job_type,status) VALUES ('$PAID_JOB','$WS4','usage_reservation_test','queued')" >/dev/null
[ "$(q -c "SELECT reserve_draft_usage('$PAID_JOB','$WS4',current_date,current_date+30,30,'$PAID_JOB_METRIC')")" = "t" ] || fail "background job should reserve paid billing-period quota"
[ "$(q -c "SELECT count FROM usage_counters WHERE workspace_id='$WS4' AND metric='$PAID_JOB_METRIC'")" = "1" ] || fail "background job reservation must increment the paid period metric"
q -c "UPDATE agent_jobs SET status='failed_terminal' WHERE id='$PAID_JOB'" >/dev/null
[ "$(q -c "SELECT count FROM usage_counters WHERE workspace_id='$WS4' AND metric='$PAID_JOB_METRIC'")" = "0" ] || fail "terminal background job must release its exact paid period metric"
echo "ok: background job quota reservations release against the correct billing period"

# A Telegram job that saved a draft must not release the consumed quota
# merely because its later notification/finalization step fails.
TELEGRAM_JOB="50000000-0000-0000-0000-000000000084"
TELEGRAM_POST="30000000-0000-0000-0000-000000000084"
TELEGRAM_METRIC="draft_items_created@2026-11-14T13:00:00.000Z"
q -c "INSERT INTO agent_jobs(id,workspace_id,job_type,status) VALUES ('$TELEGRAM_JOB','$WS4','telegram_content_generation','running')" >/dev/null
[ "$(q -c "SELECT reserve_draft_usage('$TELEGRAM_JOB','$WS4',current_date,current_date+30,30,'$TELEGRAM_METRIC')")" = "t" ] || fail "Telegram job should reserve its billing-period quota"
q -c "INSERT INTO content_posts(id,workspace_id,status,telegram_job_id) VALUES ('$TELEGRAM_POST','$WS4','draft','$TELEGRAM_JOB')" >/dev/null
q -c "UPDATE agent_jobs SET status='failed_terminal' WHERE id='$TELEGRAM_JOB'" >/dev/null
[ "$(q -c "SELECT count FROM usage_counters WHERE workspace_id='$WS4' AND metric='$TELEGRAM_METRIC'")" = "1" ] || fail "saved Telegram draft must keep its consumed quota"
[ "$(q -c "SELECT payload ? 'draft_usage_reserved_period' FROM agent_jobs WHERE id='$TELEGRAM_JOB'")" = "f" ] || fail "terminal Telegram job should clear reservation metadata"
echo "ok: persisted Telegram drafts retain consumed quota after terminal job failure"

# API draft creation reserves quota before generation and commits the post,
# initial version, and counter in one transaction.
QUOTA_WS="10000000-0000-0000-0000-000000000031"
QUOTA_OWNER="70000000-0000-0000-0000-000000000031"
q -c "INSERT INTO profiles(id) VALUES ('$QUOTA_OWNER')" >/dev/null
q -c "INSERT INTO workspaces(id,owner_user_id) VALUES ('$QUOTA_WS','$QUOTA_OWNER')" >/dev/null
for n in $(seq 1 64); do
  (
    psql -At -c "SELECT allowed::TEXT || ':' || COALESCE(reservation_id::TEXT,'') FROM reserve_draft_usage_slot('$QUOTA_WS','$QUOTA_OWNER',date_trunc('month',current_date)::DATE,(date_trunc('month',current_date)+interval '1 month - 1 day')::DATE,30)" \
      >> "$OUT/api-quota-reservations.txt" 2>> "$OUT/api-quota-errors.txt" \
      || echo "psql reservation request failed" >> "$OUT/api-quota-reservations.txt"
  ) &
done
wait
API_RESERVED=$(grep -c '^true:' "$OUT/api-quota-reservations.txt" || true)
API_DENIED=$(grep -c '^false:' "$OUT/api-quota-reservations.txt" || true)
[ "$API_RESERVED" = "30" ] || { cat "$OUT/api-quota-errors.txt" 2>/dev/null || true; fail "API quota must grant exactly 30 concurrent reservations, got $API_RESERVED"; }
[ "$API_DENIED" = "34" ] || fail "API quota must deny remaining concurrent reservations, got $API_DENIED"
RESERVATION_ID=$(grep '^true:' "$OUT/api-quota-reservations.txt" | head -n 1 | cut -d: -f2)
CREATED_POST=$(q -c "SELECT id FROM create_draft_with_usage('$RESERVATION_ID','$QUOTA_WS','$QUOTA_OWNER','A tested draft','Test title',NULL,NULL,'draft')")
[ -n "$CREATED_POST" ] || fail "atomic draft creation must return a post ID"
[ "$(q -c "SELECT count(*) FROM content_post_versions WHERE post_id='$CREATED_POST' AND version_number=1")" = "1" ] || fail "initial version must be committed with the draft"
[ "$(q -c "SELECT count FROM usage_counters WHERE workspace_id='$QUOTA_WS' AND metric='draft_items_created'")" = "1" ] || fail "draft usage must increment in the same transaction"
[ "$(q -c "SELECT count(*) FROM draft_usage_reservations WHERE id='$RESERVATION_ID' AND status='committed'")" = "1" ] || fail "committed reservation must be retained as an idempotency receipt"
RETRIED_POST=$(q -c "SELECT id FROM create_draft_with_usage('$RESERVATION_ID','$QUOTA_WS','$QUOTA_OWNER','A tested draft','Test title',NULL,NULL,'draft')")
[ "$RETRIED_POST" = "$CREATED_POST" ] || fail "retrying a committed reservation must return the same post"
[ "$(q -c "SELECT count FROM usage_counters WHERE workspace_id='$QUOTA_WS' AND metric='draft_items_created'")" = "1" ] || fail "idempotent draft retry must not double count usage"
echo "ok: concurrent API draft creation enforces the monthly cap and commits post/version/usage atomically"

# Releasing a failed request frees its reserved slot; an expired reservation
# is also removed before the next reservation attempt.
RELEASE_ID=$(grep '^true:' "$OUT/api-quota-reservations.txt" | sed -n '2p' | cut -d: -f2)
[ -n "$RELEASE_ID" ] || fail "expected a second active reservation to release"
[ "$(q -c "SELECT release_draft_usage_slot('$RELEASE_ID','$QUOTA_WS','$QUOTA_OWNER')")" = "t" ] || fail "failed generation must release its reservation"
EXPIRED_ID=$(q -c "SELECT reservation_id FROM reserve_draft_usage_slot('$QUOTA_WS','$QUOTA_OWNER',date_trunc('month',current_date)::DATE,(date_trunc('month',current_date)+interval '1 month - 1 day')::DATE,30)")
q -c "UPDATE draft_usage_reservations SET expires_at=now()-interval '1 second' WHERE id='$EXPIRED_ID'" >/dev/null
NEXT_ID=$(q -c "SELECT reservation_id FROM reserve_draft_usage_slot('$QUOTA_WS','$QUOTA_OWNER',date_trunc('month',current_date)::DATE,(date_trunc('month',current_date)+interval '1 month - 1 day')::DATE,30)")
[ -n "$NEXT_ID" ] || fail "expired reservation must not permanently consume quota"
MIXED_JOB="50000000-0000-0000-0000-000000000083"
q -c "INSERT INTO agent_jobs(id,workspace_id,job_type,status) VALUES ('$MIXED_JOB','$QUOTA_WS','mixed_quota_test','queued')" >/dev/null
MIXED_RESULT=$(q -c "SELECT reserve_draft_usage('$MIXED_JOB','$QUOTA_WS',date_trunc('month',current_date)::DATE,(date_trunc('month',current_date)+interval '1 month - 1 day')::DATE,30,'draft_items_created')")
[ "$MIXED_RESULT" = "f" ] || fail "background jobs must count API-held draft reservations before reserving"
echo "ok: API and background draft creation share one atomic quota pool"
echo "ok: failed and expired draft reservations release quota"

# Wrong workspace owner cannot reserve draft usage.
OTHER_OWNER="70000000-0000-0000-0000-000000000032"
q -c "INSERT INTO profiles(id) VALUES ('$OTHER_OWNER')" >/dev/null
if q -c "SELECT * FROM reserve_draft_usage_slot('$QUOTA_WS','$OTHER_OWNER',date_trunc('month',current_date)::DATE,(date_trunc('month',current_date)+interval '1 month - 1 day')::DATE,30)" >/dev/null 2>&1; then
  fail "non-owner must not reserve draft quota"
fi
echo "ok: draft usage RPC verifies workspace ownership"

# Different verified billing-cycle starts on the same UTC date must use
# independent counters, rather than sharing a calendar-date bucket.
PAID_METRIC_A="draft_items_created@2026-11-14T10:00:00.000Z"
PAID_METRIC_B="draft_items_created@2026-11-14T16:00:00.000Z"
PAID_RES_A=$(q -c "SELECT reservation_id FROM reserve_draft_usage_slot('$QUOTA_WS','$QUOTA_OWNER',current_date,current_date+30,30,'$PAID_METRIC_A')")
PAID_RES_B=$(q -c "SELECT reservation_id FROM reserve_draft_usage_slot('$QUOTA_WS','$QUOTA_OWNER',current_date,current_date+30,30,'$PAID_METRIC_B')")
[ -n "$PAID_RES_A" ] && [ -n "$PAID_RES_B" ] || fail "distinct paid billing periods must reserve independent slots"
PAID_POST_A=$(q -c "SELECT id FROM create_draft_with_usage('$PAID_RES_A','$QUOTA_WS','$QUOTA_OWNER','Billing cycle A','A',NULL,NULL,'draft')")
PAID_POST_B=$(q -c "SELECT id FROM create_draft_with_usage('$PAID_RES_B','$QUOTA_WS','$QUOTA_OWNER','Billing cycle B','B',NULL,NULL,'draft')")
[ "$(q -c "SELECT count(*) FROM usage_counters WHERE workspace_id='$QUOTA_WS' AND metric IN ('$PAID_METRIC_A','$PAID_METRIC_B') AND count=1")" = "2" ] || fail "paid billing periods must have independent usage counters"
echo "ok: paid billing-period keys remain distinct even when their UTC start date matches"

# Only service_role may call privileged functions.
[ "$(q -c "SELECT has_function_privilege('anon','public.claim_workspace_publish_slot(uuid,uuid)','EXECUTE')")" = "f" ] || fail "anon must not claim publish slots"
[ "$(q -c "SELECT has_function_privilege('authenticated','public.reserve_draft_usage(uuid,uuid,date,date,integer,text)','EXECUTE')")" = "f" ] || fail "authenticated must not reserve usage"
[ "$(q -c "SELECT has_function_privilege('service_role','public.reserve_draft_usage(uuid,uuid,date,date,integer,text)','EXECUTE')")" = "t" ] || fail "service_role must reserve usage"
[ "$(q -c "SELECT has_function_privilege('anon','public.begin_agent_job_execution(uuid,integer,timestamptz,timestamptz)','EXECUTE')")" = "f" ] || fail "anon must not begin job execution"
[ "$(q -c "SELECT has_function_privilege('service_role','public.begin_agent_job_execution(uuid,integer,timestamptz,timestamptz)','EXECUTE')")" = "t" ] || fail "service_role must begin job execution"
[ "$(q -c "SELECT has_function_privilege('anon','public.cancel_scheduled_post_atomic(uuid,uuid)','EXECUTE')")" = "f" ] || fail "anon must not cancel scheduled posts"
[ "$(q -c "SELECT has_function_privilege('authenticated','public.cancel_scheduled_post_atomic(uuid,uuid)','EXECUTE')")" = "f" ] || fail "authenticated must not cancel scheduled posts"
[ "$(q -c "SELECT has_function_privilege('service_role','public.cancel_scheduled_post_atomic(uuid,uuid)','EXECUTE')")" = "t" ] || fail "service_role must cancel scheduled posts"
[ "$(q -c "SELECT has_function_privilege('anon','public.schedule_post_atomic(uuid,uuid,uuid,timestamptz)','EXECUTE')")" = "f" ] || fail "anon must not schedule posts"
[ "$(q -c "SELECT has_function_privilege('authenticated','public.schedule_post_atomic(uuid,uuid,uuid,timestamptz)','EXECUTE')")" = "f" ] || fail "authenticated must not call privileged schedule RPC"
[ "$(q -c "SELECT has_function_privilege('service_role','public.schedule_post_atomic(uuid,uuid,uuid,timestamptz)','EXECUTE')")" = "t" ] || fail "service_role must schedule posts"
echo "ok: worker-only execution grants enforced"

echo "ALL WORKER SAFETY CHECKS PASSED"
