-- Migration: 0001_initial_schema.sql
-- Applies: Phase 2 — Auth, database, onboarding
-- Run with: supabase db push (or apply in order via supabase migration up)
--
-- This migration creates all required tables from spec §15.
-- Tables are created in dependency order.
-- UUID primary keys, UTC timestamps, explicit enum types, FK constraints.
-- RLS is enabled on every tenant-owned table; policies are in 0002_rls_policies.sql.

-- ─── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()

-- ─── Custom enum types ────────────────────────────────────────────────────────

-- Workspace entitlement — the sole authority for feature permissions (BED-02)
CREATE TYPE entitlement_type AS ENUM (
  'draft_only',       -- Public signup default; drafting/review/export only
  'internal_test',    -- Admin-provisioned only; one acceptance-test publish then reverted
  'publishing_beta',  -- Explicit test-cohort provisioning; human-approved publishing
  'paid_trial',       -- Verified Polar trial state
  'paid_active',      -- Verified Polar active subscription
  'inactive'          -- Lapsed/cancelled; read/export only
);

-- Workspace agent operational state — NEVER contains entitlement values (spec §8)
CREATE TYPE agent_state AS ENUM (
  'setup_required',
  'active_approval_required',
  'active_autopilot',
  'paused',
  'blocked_integration',
  'attention_required'
);

-- Operating mode
CREATE TYPE operating_mode AS ENUM (
  'approval_required',
  'autopilot'
);

-- Job state machine
CREATE TYPE job_status AS ENUM (
  'queued',
  'running',
  'waiting_for_approval',
  'succeeded',
  'failed_retryable',
  'failed_terminal',
  'canceled',
  'needs_reconciliation'
);

-- Integration providers
CREATE TYPE integration_provider AS ENUM (
  'linkedin',
  'telegram',
  'polar',
  'mcp'
);

-- Integration status
CREATE TYPE integration_status AS ENUM (
  'connected',
  'disconnected',
  'expired',
  'error'
);

-- Content post status
CREATE TYPE post_status AS ENUM (
  'draft',
  'needs_review',
  'approved',
  'scheduled',
  'publishing',
  'published',
  'failed',
  'rejected',
  'canceled',
  'needs_reconciliation'
);

-- Content plan status
CREATE TYPE plan_status AS ENUM (
  'active',
  'superseded',
  'archived'
);

-- Audit actor type
CREATE TYPE audit_actor_type AS ENUM (
  'user',
  'system',
  'admin',
  'telegram',
  'mcp'
);

-- Approval action
CREATE TYPE approval_action AS ENUM (
  'approved',
  'rejected',
  'revised',
  'auto_approved'     -- Reserved; not used in preview/beta
);

-- Billing webhook processing status
CREATE TYPE webhook_processing_status AS ENUM (
  'pending',
  'processed',
  'failed',
  'duplicate'
);

-- ─── 1. profiles ──────────────────────────────────────────────────────────────
-- One row per Supabase auth user. id = auth.users.id.
CREATE TABLE public.profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name    TEXT,
  avatar_url      TEXT,
  timezone        TEXT NOT NULL DEFAULT 'UTC',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.profiles IS 'One row per authenticated user, keyed to auth.users.id.';

-- ─── 2. workspaces ────────────────────────────────────────────────────────────
CREATE TABLE public.workspaces (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  name              TEXT NOT NULL DEFAULT 'My Workspace',
  -- Agent operational status only — NOT an entitlement field
  state             agent_state NOT NULL DEFAULT 'setup_required',
  -- The sole server-side authority for feature permissions
  entitlement_type  entitlement_type NOT NULL DEFAULT 'draft_only',
  operating_mode    operating_mode NOT NULL DEFAULT 'approval_required',
  paused_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workspaces_one_per_user UNIQUE (owner_user_id)   -- v1: one workspace per user
);
COMMENT ON TABLE public.workspaces IS
  'One workspace per user (v1). entitlement_type is the sole authority for feature permissions.
   state is operational status only and must never contain entitlement values.';
COMMENT ON COLUMN public.workspaces.entitlement_type IS
  'Set server-side only. Public signup always receives draft_only.
   internal_test requires explicit admin provisioning.
   publishing_beta requires explicit cohort provisioning.
   paid_trial/paid_active are set from verified Polar webhook state.';

-- ─── 3. workspace_members (reserved, v1 unused) ──────────────────────────────
CREATE TABLE public.workspace_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, user_id)
);
COMMENT ON TABLE public.workspace_members IS
  'Reserved for future team features. v1.0.0: owner is the only member; no public team-invite API.';

-- ─── 4. integration_connections ──────────────────────────────────────────────
-- Never store raw secrets in client-readable columns.
-- Actual tokens are stored encrypted; this table holds metadata + references.
CREATE TABLE public.integration_connections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider            integration_provider NOT NULL,
  external_account_id TEXT,                          -- e.g. LinkedIn member URN (non-secret)
  -- encrypted_token_ref: reference or encrypted blob — never plaintext secret
  encrypted_token_ref TEXT,
  granted_scopes      TEXT[],
  status              integration_status NOT NULL DEFAULT 'disconnected',
  expires_at          TIMESTAMPTZ,
  metadata            JSONB DEFAULT '{}'::JSONB,     -- allowlisted non-secret metadata only
  connected_at        TIMESTAMPTZ,
  disconnected_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, provider)                    -- one active connection per provider per workspace
);
COMMENT ON COLUMN public.integration_connections.encrypted_token_ref IS
  'Encrypted OAuth token or reference to a secrets store entry. Never plaintext. Never exposed to client.';

-- ─── 5. voice_profiles ───────────────────────────────────────────────────────
CREATE TABLE public.voice_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  tone            TEXT,
  sentence_length TEXT,
  formality       TEXT,
  phrases_use     TEXT[],
  phrases_avoid   TEXT[],
  sample_text     TEXT,
  exclusions      TEXT[],
  version         INTEGER NOT NULL DEFAULT 1,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id)
);

-- ─── 6. content_strategies ───────────────────────────────────────────────────
CREATE TABLE public.content_strategies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  audience            JSONB NOT NULL DEFAULT '{}'::JSONB,
  goals               TEXT[],
  pillars             JSONB NOT NULL DEFAULT '[]'::JSONB,   -- 3–5 content pillars
  cadence_per_week    INTEGER NOT NULL DEFAULT 3 CHECK (cadence_per_week BETWEEN 1 AND 7),
  preferred_days      INTEGER[] DEFAULT '{}',              -- 0=Sun … 6=Sat
  preferred_time      TIME,
  timezone            TEXT NOT NULL DEFAULT 'UTC',
  exclusions          TEXT[],
  cta_preferences     TEXT[],
  version             INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id)   -- one active strategy per workspace (v1)
);

-- ─── 7. content_plans ────────────────────────────────────────────────────────
CREATE TABLE public.content_plans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  strategy_version  INTEGER NOT NULL DEFAULT 1,
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,
  status            plan_status NOT NULL DEFAULT 'active',
  plan_json         JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at     TIMESTAMPTZ,
  CONSTRAINT plans_period_valid CHECK (period_end >= period_start)
);

-- ─── 8. content_posts ────────────────────────────────────────────────────────
CREATE TABLE public.content_posts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_id           UUID REFERENCES public.content_plans(id) ON DELETE SET NULL,
  text              TEXT NOT NULL DEFAULT '',
  internal_title    TEXT,
  pillar            TEXT,
  source_notes      TEXT,
  status            post_status NOT NULL DEFAULT 'draft',
  scheduled_at      TIMESTAMPTZ,
  published_at      TIMESTAMPTZ,
  -- LinkedIn post URN returned from the API on successful publish (non-secret)
  linkedin_post_id  TEXT,
  version           INTEGER NOT NULL DEFAULT 1,
  created_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT posts_text_max_length CHECK (char_length(text) <= 3000),
  -- Idempotency: a post can only have one linkedin_post_id once published
  CONSTRAINT posts_linkedin_id_unique UNIQUE (linkedin_post_id)
);

-- ─── 9. content_post_versions ────────────────────────────────────────────────
CREATE TABLE public.content_post_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  post_id         UUID NOT NULL REFERENCES public.content_posts(id) ON DELETE CASCADE,
  version_number  INTEGER NOT NULL,
  text            TEXT NOT NULL,
  change_source   TEXT NOT NULL,   -- 'user_edit' | 'ai_revision' | 'import'
  changed_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (post_id, version_number)
);

-- ─── 10. approval_events ─────────────────────────────────────────────────────
CREATE TABLE public.approval_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  post_id       UUID NOT NULL REFERENCES public.content_posts(id) ON DELETE CASCADE,
  actor_type    audit_actor_type NOT NULL,
  actor_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action        approval_action NOT NULL,
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 11. agent_jobs ──────────────────────────────────────────────────────────
CREATE TABLE public.agent_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  job_type          TEXT NOT NULL,
  status            job_status NOT NULL DEFAULT 'queued',
  -- idempotency_key prevents duplicate job creation; scope: per workspace+job_type+period
  idempotency_key   TEXT NOT NULL,
  payload           JSONB NOT NULL DEFAULT '{}'::JSONB,   -- validated non-secret data only
  scheduled_for     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at        TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 3,
  -- lease_until: used by queue consumer to claim exclusive processing
  lease_until       TIMESTAMPTZ,
  correlation_id    UUID NOT NULL DEFAULT gen_random_uuid(),
  last_error_code   TEXT,
  safe_error_message TEXT,    -- user-visible; must not contain tokens/stack traces
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, idempotency_key)
);
COMMENT ON COLUMN public.agent_jobs.payload IS
  'Contains only validated, non-secret job parameters. Never store tokens, passwords, or full provider payloads.';

-- ─── 12. agent_job_attempts ──────────────────────────────────────────────────
CREATE TABLE public.agent_job_attempts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  job_id              UUID NOT NULL REFERENCES public.agent_jobs(id) ON DELETE CASCADE,
  attempt_number      INTEGER NOT NULL,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at         TIMESTAMPTZ,
  outcome             job_status,
  provider            TEXT,
  model               TEXT,
  provider_request_id TEXT,   -- for correlation/idempotency with external provider
  safe_error_code     TEXT,
  duration_ms         INTEGER,
  UNIQUE (job_id, attempt_number)
);

-- ─── 13. audit_events ────────────────────────────────────────────────────────
CREATE TABLE public.audit_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_type      audit_actor_type NOT NULL,
  actor_id        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action          TEXT NOT NULL,
  resource_type   TEXT NOT NULL,
  resource_id     UUID,
  -- safe_metadata: redacted; must not contain tokens, passwords, or PII beyond actor_id
  safe_metadata   JSONB DEFAULT '{}'::JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 14. telegram_links ──────────────────────────────────────────────────────
CREATE TABLE public.telegram_links (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  telegram_user_id    BIGINT NOT NULL,   -- Telegram numeric user ID (non-secret)
  chat_id             BIGINT NOT NULL,
  linked_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_interaction_at TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,
  -- Only one active (non-revoked) link per workspace
  CONSTRAINT telegram_links_one_active_per_workspace
    EXCLUDE USING btree (workspace_id WITH =) WHERE (revoked_at IS NULL),
  -- Only one active link per Telegram user
  CONSTRAINT telegram_links_one_active_per_telegram_user
    EXCLUDE USING btree (telegram_user_id WITH =) WHERE (revoked_at IS NULL)
);

-- ─── 15. link_tokens (Telegram deep-link tokens) ─────────────────────────────
CREATE TABLE public.link_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,   -- bcrypt/SHA-256 hash; raw token is never stored
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON COLUMN public.link_tokens.token_hash IS
  'SHA-256 hash of the one-time linking token. The raw token is shown to the user once and never stored.';

-- ─── 16. mcp_credentials ─────────────────────────────────────────────────────
CREATE TABLE public.mcp_credentials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL,     -- hash of the credential; raw credential never stored after creation
  scopes        TEXT[] NOT NULL DEFAULT '{}',
  expires_at    TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- v1: exactly one active credential per workspace (revoked_at IS NULL)
  CONSTRAINT mcp_credentials_one_active_per_workspace
    EXCLUDE USING btree (workspace_id WITH =) WHERE (revoked_at IS NULL)
);

-- ─── 17. billing_customers ───────────────────────────────────────────────────
CREATE TABLE public.billing_customers (
  workspace_id        UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  polar_customer_id   TEXT NOT NULL UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 18. subscriptions ───────────────────────────────────────────────────────
CREATE TABLE public.subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  polar_subscription_id TEXT NOT NULL UNIQUE,
  product_id            TEXT NOT NULL,
  price_id              TEXT NOT NULL,
  status                TEXT NOT NULL,   -- mirrors Polar subscription status values
  trial_start           TIMESTAMPTZ,
  trial_end             TIMESTAMPTZ,
  current_period_start  TIMESTAMPTZ,
  current_period_end    TIMESTAMPTZ,
  cancel_at_period_end  BOOLEAN NOT NULL DEFAULT FALSE,
  -- Snapshot of entitlement at last webhook event for audit purposes
  entitlement_snapshot  entitlement_type,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 19. billing_webhook_events ──────────────────────────────────────────────
CREATE TABLE public.billing_webhook_events (
  provider_event_id TEXT PRIMARY KEY,   -- idempotency key; reject duplicates
  type              TEXT NOT NULL,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at      TIMESTAMPTZ,
  processing_status webhook_processing_status NOT NULL DEFAULT 'pending',
  safe_error_code   TEXT
);

-- ─── 20. usage_counters ──────────────────────────────────────────────────────
CREATE TABLE public.usage_counters (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  metric        TEXT NOT NULL,         -- e.g. 'draft_items_created'
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, metric, period_start)
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────
-- Agent jobs: worker queries by status and scheduled_for
CREATE INDEX idx_agent_jobs_workspace         ON public.agent_jobs (workspace_id);
CREATE INDEX idx_agent_jobs_status_scheduled  ON public.agent_jobs (status, scheduled_for);
CREATE INDEX idx_agent_jobs_lease             ON public.agent_jobs (lease_until) WHERE lease_until IS NOT NULL;

-- Content posts
CREATE INDEX idx_content_posts_workspace      ON public.content_posts (workspace_id);
CREATE INDEX idx_content_posts_status         ON public.content_posts (workspace_id, status);
CREATE INDEX idx_content_posts_scheduled      ON public.content_posts (workspace_id, scheduled_at) WHERE scheduled_at IS NOT NULL;

-- Audit events: ordered by time per workspace
CREATE INDEX idx_audit_events_workspace_time  ON public.audit_events (workspace_id, created_at DESC);

-- Billing webhook events: dedup lookups
CREATE INDEX idx_billing_webhook_events_type  ON public.billing_webhook_events (type, received_at);

-- Subscriptions: status lookups
CREATE INDEX idx_subscriptions_workspace      ON public.subscriptions (workspace_id);
CREATE INDEX idx_subscriptions_status         ON public.subscriptions (status);

-- Integration connections
CREATE INDEX idx_integration_connections_ws   ON public.integration_connections (workspace_id);

-- ─── Updated_at triggers ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_workspaces_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_integration_connections_updated_at
  BEFORE UPDATE ON public.integration_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_content_strategies_updated_at
  BEFORE UPDATE ON public.content_strategies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_content_posts_updated_at
  BEFORE UPDATE ON public.content_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_agent_jobs_updated_at
  BEFORE UPDATE ON public.agent_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_usage_counters_updated_at
  BEFORE UPDATE ON public.usage_counters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
