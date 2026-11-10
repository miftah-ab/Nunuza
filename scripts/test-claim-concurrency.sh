#!/usr/bin/env bash
# Verifies supabase/migrations/0008_atomic_job_claim.sql against REAL Postgres.
# Requires a reachable Postgres (PGHOST/PGUSER/PGPASSWORD set) and psql.
# Proves: 8 parallel workers never claim the same job, attempts are counted once,
# leases / scheduled_for / max_attempts are respected, and client roles cannot call it.
set -euo pipefail

MIGRATION="supabase/migrations/0008_atomic_job_claim.sql"
OUT="$(mktemp -d)"
fail() { echo "FAIL: $*" >&2; exit 1; }
q() { psql -v ON_ERROR_STOP=1 -At "$@"; }

PGDATABASE=postgres q -c "DROP DATABASE IF EXISTS claimtest" -c "CREATE DATABASE claimtest" >/dev/null
export PGDATABASE=claimtest

q >/dev/null <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE TYPE job_status AS ENUM (
  'queued','running','waiting_for_approval','succeeded',
  'failed_retryable','failed_terminal','canceled','needs_reconciliation'
);

-- Same columns as 0001_initial_schema.sql (foreign keys omitted: not needed for this test)
CREATE TABLE public.agent_jobs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL,
  job_type           TEXT NOT NULL,
  status             job_status NOT NULL DEFAULT 'queued',
  idempotency_key    TEXT NOT NULL,
  payload            JSONB NOT NULL DEFAULT '{}'::JSONB,
  scheduled_for      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at         TIMESTAMPTZ,
  finished_at        TIMESTAMPTZ,
  attempt_count      INTEGER NOT NULL DEFAULT 0,
  max_attempts       INTEGER NOT NULL DEFAULT 3,
  lease_until        TIMESTAMPTZ,
  correlation_id     UUID NOT NULL DEFAULT gen_random_uuid(),
  last_error_code    TEXT,
  safe_error_message TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, idempotency_key)
);
SQL

q -f "$MIGRATION" >/dev/null
echo "migration applied"

# ── 1. Concurrency: 300 due jobs, 8 parallel workers ─────────────────────────
q -c "INSERT INTO agent_jobs (workspace_id, job_type, idempotency_key, scheduled_for)
      SELECT gen_random_uuid(), 'publish_post', 'k'||g, now() - interval '1 minute'
      FROM generate_series(1,300) g" >/dev/null

for w in 1 2 3 4 5 6 7 8; do
  (
    for _ in $(seq 1 60); do
      psql -At -c "SELECT id FROM claim_due_agent_jobs(10, 60)"
    done > "$OUT/w$w.txt"
  ) &
done
wait

cat "$OUT"/w*.txt | grep -v '^$' | sort > "$OUT/all.txt"
TOTAL=$(wc -l < "$OUT/all.txt" | tr -d ' ')
DUPES=$(uniq -d "$OUT/all.txt" | wc -l | tr -d ' ')
[ "$TOTAL" = "300" ] || fail "expected 300 claims across workers, got $TOTAL"
[ "$DUPES" = "0" ] || fail "$DUPES job(s) were claimed by more than one worker"
RUNNING=$(q -c "SELECT count(*) FROM agent_jobs WHERE status='running' AND attempt_count=1 AND lease_until > now()")
[ "$RUNNING" = "300" ] || fail "expected 300 running jobs with attempt_count=1, got $RUNNING"
echo "ok: 300 jobs claimed exactly once by 8 parallel workers (0 duplicates)"

# ── 2. Eligibility rules ─────────────────────────────────────────────────────
q -c "TRUNCATE agent_jobs" >/dev/null
q >/dev/null <<'SQL'
INSERT INTO agent_jobs (id, workspace_id, job_type, idempotency_key, status, scheduled_for, lease_until, attempt_count, max_attempts) VALUES
 ('00000000-0000-0000-0000-00000000000a', gen_random_uuid(), 'publish_post', 'future',     'queued',           now() + interval '1 hour',   NULL,                        0, 3),
 ('00000000-0000-0000-0000-00000000000b', gen_random_uuid(), 'publish_post', 'leased',     'failed_retryable', now() - interval '1 minute', now() + interval '5 minutes', 1, 3),
 ('00000000-0000-0000-0000-00000000000c', gen_random_uuid(), 'publish_post', 'running',    'running',          now() - interval '1 minute', now() - interval '1 minute',  1, 3),
 ('00000000-0000-0000-0000-00000000000d', gen_random_uuid(), 'publish_post', 'exhausted',  'failed_retryable', now() - interval '1 minute', NULL,                        3, 3),
 ('00000000-0000-0000-0000-00000000000e', gen_random_uuid(), 'publish_post', 'expired',    'queued',           now() - interval '1 minute', now() - interval '1 minute',  0, 3),
 ('00000000-0000-0000-0000-00000000000f', gen_random_uuid(), 'publish_post', 'recon',      'needs_reconciliation', now() - interval '1 minute', NULL,                    1, 3),
 ('00000000-0000-0000-0000-000000000010', gen_random_uuid(), 'other_type',   'othertype',  'queued',           now() - interval '1 minute', NULL,                        0, 3);
SQL

CLAIMED=$(q -c "SELECT id FROM claim_due_agent_jobs(100, 60, ARRAY['publish_post'])" | sort | tr '\n' ' ')
[ "$CLAIMED" = "00000000-0000-0000-0000-00000000000e " ] || fail "only the expired-lease queued job may be claimed, got: $CLAIMED"
[ "$(q -c "SELECT status FROM agent_jobs WHERE idempotency_key='exhausted'")" = "failed_terminal" ] || fail "exhausted job must become failed_terminal"
[ "$(q -c "SELECT last_error_code FROM agent_jobs WHERE idempotency_key='exhausted'")" = "MAX_ATTEMPTS_EXCEEDED" ] || fail "exhausted job must record MAX_ATTEMPTS_EXCEEDED"
[ "$(q -c "SELECT status FROM agent_jobs WHERE idempotency_key='future'")" = "queued" ] || fail "future job must stay queued"
[ "$(q -c "SELECT status FROM agent_jobs WHERE idempotency_key='leased'")" = "failed_retryable" ] || fail "actively leased job must not be claimed"
[ "$(q -c "SELECT status FROM agent_jobs WHERE idempotency_key='running'")" = "running" ] || fail "running job must not be claimed here"
[ "$(q -c "SELECT status FROM agent_jobs WHERE idempotency_key='recon'")" = "needs_reconciliation" ] || fail "needs_reconciliation must never be claimed"
[ "$(q -c "SELECT status FROM agent_jobs WHERE idempotency_key='othertype'")" = "queued" ] || fail "job type filter must be respected"
[ "$(q -c "SELECT attempt_count FROM agent_jobs WHERE idempotency_key='expired'")" = "1" ] || fail "attempt_count must increase exactly once"
echo "ok: scheduled_for, active lease, expired lease, max attempts, job type, needs_reconciliation all respected"

# ── 3. Input validation ──────────────────────────────────────────────────────
if psql -At -c "SELECT * FROM claim_due_agent_jobs(0, 60)" >/dev/null 2>&1; then fail "p_limit=0 must be rejected"; fi
if psql -At -c "SELECT * FROM claim_due_agent_jobs(10, 5)" >/dev/null 2>&1; then fail "p_lease_seconds=5 must be rejected"; fi
echo "ok: invalid arguments rejected"

# ── 4. Privileges: only service_role may claim ───────────────────────────────
SIG="public.claim_due_agent_jobs(integer,integer,text[])"
[ "$(q -c "SELECT has_function_privilege('anon','$SIG','EXECUTE')")" = "f" ] || fail "anon must not execute claim_due_agent_jobs"
[ "$(q -c "SELECT has_function_privilege('authenticated','$SIG','EXECUTE')")" = "f" ] || fail "authenticated must not execute claim_due_agent_jobs"
[ "$(q -c "SELECT has_function_privilege('service_role','$SIG','EXECUTE')")" = "t" ] || fail "service_role must execute claim_due_agent_jobs"
echo "ok: client roles cannot claim jobs; service_role can"

echo "ALL DATABASE CLAIM CHECKS PASSED"
