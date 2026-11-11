#!/usr/bin/env bash
# Exercises migration 0017 against real PostgreSQL, including per-chat lock
# concurrency, persisted state, link binding, and RPC privilege boundaries.
set -euo pipefail

: "${PGHOST:=localhost}"
: "${PGUSER:=postgres}"
: "${PGPASSWORD:=postgres}"
: "${PGDATABASE:=postgres}"
export PGHOST PGUSER PGPASSWORD PGDATABASE

OUT="$(mktemp -d)"
fail() { echo "FAIL: $*" >&2; exit 1; }
q() { psql -v ON_ERROR_STOP=1 -At "$@"; }

PGDATABASE=postgres q -c "DROP DATABASE IF EXISTS telegramconversationtest" -c "CREATE DATABASE telegramconversationtest" >/dev/null
export PGDATABASE=telegramconversationtest

q >/dev/null <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE TYPE public.job_status AS ENUM ('queued','running','waiting_for_approval','succeeded','failed_retryable','failed_terminal','canceled','needs_reconciliation');
CREATE TABLE public.agent_jobs (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  job_type TEXT NOT NULL,
  status public.job_status NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, idempotency_key)
);
CREATE TABLE public.content_posts (id UUID PRIMARY KEY, workspace_id UUID, agent_cycle_key TEXT);
CREATE TABLE public.content_post_versions (id UUID PRIMARY KEY);
CREATE TABLE public.usage_counters (workspace_id UUID, metric TEXT, period_start DATE, count INTEGER, updated_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE public.telegram_links (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  telegram_user_id BIGINT NOT NULL,
  chat_id BIGINT NOT NULL,
  revoked_at TIMESTAMPTZ
);

INSERT INTO public.telegram_links (id, workspace_id, telegram_user_id, chat_id, revoked_at)
VALUES
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 101, 202, NULL),
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 303, 404, NOW()),
  ('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 303, 404, NULL);
SQL

q -f supabase/migrations/0017_telegram_conversational_content.sql >/dev/null
echo "migration applied"

# Eight independent webhook turns race for one linked chat. Exactly one may
# acquire the per-chat lease; all others must observe it as busy.
WINNER=""
for n in $(seq 1 8); do
  (
    TOKEN=$(printf "30000000-0000-0000-0000-%012d" "$n")
    RESULT=$(psql -At -c "SELECT public.claim_telegram_conversation(101,202,'20000000-0000-0000-0000-000000000001','$TOKEN'::uuid)->>'claimed'")
    if [ "$RESULT" = "true" ]; then echo "$TOKEN" > "$OUT/winner-$n.txt"; fi
  ) &
done
wait
WINNERS=$(find "$OUT" -name 'winner-*.txt' | wc -l | tr -d ' ')
[ "$WINNERS" = "1" ] || fail "expected one chat lock owner across 8 concurrent requests, got $WINNERS"
WINNER=$(cat "$OUT"/winner-*.txt)
echo "ok: one per-chat turn lock owner across 8 concurrent requests"

# A wrong chat/user cannot acquire the active workspace conversation.
WRONG=$(q -c "SELECT public.claim_telegram_conversation(101,999,'20000000-0000-0000-0000-000000000001',gen_random_uuid())->>'reason'")
[ "$WRONG" = "not_linked" ] || fail "wrong chat must not access conversation state"

# The lock owner persists only compact context, then another turn can claim it.
STATE='{"activePostId":"40000000-0000-0000-0000-000000000001","topic":"Hiring lessons","updatedAt":"2026-11-11T13:00:00Z"}'
RELEASED=$(q -c "SELECT public.release_telegram_conversation(101,202,'20000000-0000-0000-0000-000000000001','$WINNER'::uuid,'$STATE'::jsonb)")
[ "$RELEASED" = "t" ] || fail "current lock owner must persist conversation state"
CLAIM=$(q -c "SELECT public.claim_telegram_conversation(101,202,'20000000-0000-0000-0000-000000000001',gen_random_uuid())")
echo "$CLAIM" | grep -q '"claimed": true' || fail "released conversation must be claimable"
echo "$CLAIM" | grep -q '"activePostId": "40000000-0000-0000-0000-000000000001"' || fail "active draft pointer must persist"

# Revoke the link while a lock is held; subsequent claims must fail closed.
q -c "UPDATE public.telegram_links SET revoked_at=NOW() WHERE telegram_user_id=101 AND chat_id=202" >/dev/null
REVOKED=$(q -c "SELECT public.claim_telegram_conversation(101,202,'20000000-0000-0000-0000-000000000001',gen_random_uuid())->>'reason'")
[ "$REVOKED" = "not_linked" ] || fail "revoked Telegram links must not claim conversation state"

# Privileged RPCs must be callable only by the service role.
CLAIM_SIG="public.claim_telegram_conversation(bigint,bigint,uuid,uuid)"
RELEASE_SIG="public.release_telegram_conversation(bigint,bigint,uuid,uuid,jsonb)"
COMPLETE_SIG="public.complete_telegram_conversation_job(bigint,bigint,uuid,uuid,jsonb)"
ENQUEUE_SIG="public.enqueue_telegram_content_job(bigint,bigint,uuid,uuid,uuid,text,jsonb,jsonb)"
[ "$(q -c "SELECT has_function_privilege('anon','$CLAIM_SIG','EXECUTE')")" = "f" ] || fail "anon must not claim Telegram conversations"
[ "$(q -c "SELECT has_function_privilege('authenticated','$CLAIM_SIG','EXECUTE')")" = "f" ] || fail "authenticated must not claim Telegram conversations"
[ "$(q -c "SELECT has_function_privilege('service_role','$CLAIM_SIG','EXECUTE')")" = "t" ] || fail "service_role must claim Telegram conversations"
[ "$(q -c "SELECT has_function_privilege('anon','$RELEASE_SIG','EXECUTE')")" = "f" ] || fail "anon must not release Telegram conversations"
[ "$(q -c "SELECT has_function_privilege('authenticated','$RELEASE_SIG','EXECUTE')")" = "f" ] || fail "authenticated must not release Telegram conversations"
[ "$(q -c "SELECT has_function_privilege('service_role','$RELEASE_SIG','EXECUTE')")" = "t" ] || fail "service_role must release Telegram conversations"
[ "$(q -c "SELECT has_function_privilege('anon','$COMPLETE_SIG','EXECUTE')")" = "f" ] || fail "anon must not complete Telegram conversations"
[ "$(q -c "SELECT has_function_privilege('authenticated','$COMPLETE_SIG','EXECUTE')")" = "f" ] || fail "authenticated must not complete Telegram conversations"
[ "$(q -c "SELECT has_function_privilege('service_role','$COMPLETE_SIG','EXECUTE')")" = "t" ] || fail "service_role must complete Telegram conversations"
[ "$(q -c "SELECT has_function_privilege('anon','$ENQUEUE_SIG','EXECUTE')")" = "f" ] || fail "anon must not enqueue Telegram content jobs"
[ "$(q -c "SELECT has_function_privilege('authenticated','$ENQUEUE_SIG','EXECUTE')")" = "f" ] || fail "authenticated must not enqueue Telegram content jobs"
[ "$(q -c "SELECT has_function_privilege('service_role','$ENQUEUE_SIG','EXECUTE')")" = "t" ] || fail "service_role must enqueue Telegram content jobs"

# The worker completion RPC is fenced by the pending job ID.
JOB_ID='50000000-0000-0000-0000-000000000001'
LOCK_TOKEN='70000000-0000-0000-0000-000000000001'
CLAIM=$(q -c "SELECT public.claim_telegram_conversation(303,404,'20000000-0000-0000-0000-000000000003','$LOCK_TOKEN'::uuid)")
echo "$CLAIM" | grep -q '"claimed": true' || fail "active chat must acquire a conversation lock"
ENQUEUED=$(q -c "SELECT public.enqueue_telegram_content_job(303,404,'20000000-0000-0000-0000-000000000003','$LOCK_TOKEN'::uuid,'$JOB_ID'::uuid,'telegram-content-987654','{\"text\":\"draft request\"}'::jsonb,'{\"topic\":\"Hiring\"}'::jsonb)")
echo "$ENQUEUED" | grep -q '"queued": true' || fail "job and pending conversation state must be enqueued atomically"
[ "$(q -c "SELECT status FROM public.agent_jobs WHERE id='$JOB_ID'")" = "queued" ] || fail "Telegram content job must be queued"
[ "$(q -c "SELECT conversation_state->>'pendingJobId' FROM public.telegram_links WHERE telegram_user_id=303 AND revoked_at IS NULL")" = "$JOB_ID" ] || fail "conversation must point to the queued job"
LOCK_TOKEN_2='70000000-0000-0000-0000-000000000002'
q -c "SELECT public.claim_telegram_conversation(303,404,'20000000-0000-0000-0000-000000000003','$LOCK_TOKEN_2'::uuid)" >/dev/null
DUPLICATE=$(q -c "SELECT public.enqueue_telegram_content_job(303,404,'20000000-0000-0000-0000-000000000003','$LOCK_TOKEN_2'::uuid,'50000000-0000-0000-0000-000000000002'::uuid,'telegram-content-987654','{\"text\":\"same request\"}'::jsonb,'{\"topic\":\"Hiring\"}'::jsonb)")
echo "$DUPLICATE" | grep -q '"job_id": "50000000-0000-0000-0000-000000000001"' || fail "duplicate webhook delivery must reuse the existing job"
[ "$(q -c "SELECT COUNT(*) FROM public.agent_jobs WHERE workspace_id='20000000-0000-0000-0000-000000000003' AND idempotency_key='telegram-content-987654'")" = "1" ] || fail "idempotency key must prevent duplicate jobs"
DONE=$(q -c "SELECT public.complete_telegram_conversation_job(303,404,'20000000-0000-0000-0000-000000000003','$JOB_ID'::uuid,'{\"activePostId\":\"60000000-0000-0000-0000-000000000001\"}'::jsonb)")
[ "$DONE" = "t" ] || fail "matching job must complete conversation state"
STALE=$(q -c "SELECT public.complete_telegram_conversation_job(303,404,'20000000-0000-0000-0000-000000000002',gen_random_uuid(),'{}'::jsonb)")
[ "$STALE" = "f" ] || fail "stale job must not overwrite conversation state"
q -c "INSERT INTO public.content_posts(id,workspace_id,telegram_job_id) VALUES ('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','$JOB_ID')" >/dev/null
q -c "UPDATE public.agent_jobs SET payload=payload || jsonb_build_object('draft_usage_reserved_period','2026-11-01') WHERE id='$JOB_ID'" >/dev/null
q -c "INSERT INTO public.usage_counters(workspace_id,metric,period_start,count) VALUES ('20000000-0000-0000-0000-000000000003','draft_items_created','2026-11-01',1)" >/dev/null
q -c "SELECT public.release_draft_usage('$JOB_ID')" >/dev/null
[ "$(q -c "SELECT count FROM public.usage_counters WHERE workspace_id='20000000-0000-0000-0000-000000000003' AND period_start='2026-11-01'")" = "1" ] || fail "terminal cleanup must preserve usage for an already committed Telegram draft"
q -c "INSERT INTO public.content_post_versions(id,telegram_job_id) VALUES ('80000000-0000-0000-0000-000000000001','$JOB_ID')" >/dev/null
if psql -v ON_ERROR_STOP=1 -c "INSERT INTO public.content_posts(id,workspace_id,telegram_job_id) VALUES ('60000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','$JOB_ID')" >/dev/null 2>&1; then
  fail "one generation job must not create duplicate posts"
fi
if psql -v ON_ERROR_STOP=1 -c "INSERT INTO public.content_post_versions(id,telegram_job_id) VALUES ('80000000-0000-0000-0000-000000000002','$JOB_ID')" >/dev/null 2>&1; then
  fail "one revision job must not create duplicate versions"
fi

echo "ALL TELEGRAM CONVERSATION MIGRATION CHECKS PASSED"
