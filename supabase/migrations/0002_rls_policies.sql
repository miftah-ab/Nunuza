-- Migration: 0002_rls_policies.sql
-- Applies after: 0001_initial_schema.sql
--
-- Enables Row Level Security on every tenant-owned table.
-- All policies use auth.uid() — the authenticated Supabase user's UUID.
-- server-side service-role clients bypass RLS by design; these policies
-- protect browser-scoped (anon/authenticated role) clients only.
-- Server services MUST also enforce workspace authorization independently
-- (defense in depth — spec §17).
--
-- Policy naming convention:
--   <table>_<role>_<action>  e.g. workspaces_owner_select

-- ─── Enable RLS on all tenant-owned tables ────────────────────────────────────
ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_strategies    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_plans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_posts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_post_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_jobs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_job_attempts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_links        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_tokens           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_credentials       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_customers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_counters        ENABLE ROW LEVEL SECURITY;
-- billing_webhook_events: no user-scoped access; service-role only.
-- No RLS needed — anon/authenticated roles have no access.

-- ─── Helper function: get the caller's workspace_id ──────────────────────────
-- Returns the workspace owned by the current authenticated user (or NULL).
-- Used in WHERE clauses to enforce tenant isolation without a subquery per row.
CREATE OR REPLACE FUNCTION public.current_workspace_id()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER
AS $$
  SELECT id FROM public.workspaces WHERE owner_user_id = auth.uid() LIMIT 1;
$$;

-- ─── profiles ─────────────────────────────────────────────────────────────────
-- Users can only read/update their own profile.
CREATE POLICY profiles_owner_select ON public.profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY profiles_owner_update ON public.profiles
  FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- System creates profile on signup (via trigger/function); no INSERT policy needed for users.

-- ─── workspaces ──────────────────────────────────────────────────────────────
CREATE POLICY workspaces_owner_select ON public.workspaces
  FOR SELECT USING (owner_user_id = auth.uid());

CREATE POLICY workspaces_owner_update ON public.workspaces
  FOR UPDATE USING (owner_user_id = auth.uid())
  WITH CHECK (
    owner_user_id = auth.uid()
    -- Clients cannot change entitlement_type; that is service-role only.
    -- This is enforced in application code as well (defense in depth).
  );

-- No INSERT for users: workspace is created by service-role on signup.
-- No DELETE for users: deletion goes through the account-deletion flow (service-role).

-- ─── workspace_members ───────────────────────────────────────────────────────
-- v1: no user-facing member management; owner sees their own membership.
CREATE POLICY workspace_members_owner_select ON public.workspace_members
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
  );

-- ─── integration_connections ─────────────────────────────────────────────────
-- Workspace owner can read their own connections (metadata only — token is server-side).
CREATE POLICY integration_connections_owner_select ON public.integration_connections
  FOR SELECT USING (workspace_id = public.current_workspace_id());

-- No client-side INSERT/UPDATE/DELETE — managed by service-role OAuth flow only.

-- ─── voice_profiles ──────────────────────────────────────────────────────────
CREATE POLICY voice_profiles_owner_select ON public.voice_profiles
  FOR SELECT USING (workspace_id = public.current_workspace_id());

CREATE POLICY voice_profiles_owner_insert ON public.voice_profiles
  FOR INSERT WITH CHECK (workspace_id = public.current_workspace_id());

CREATE POLICY voice_profiles_owner_update ON public.voice_profiles
  FOR UPDATE USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

-- ─── content_strategies ──────────────────────────────────────────────────────
CREATE POLICY content_strategies_owner_select ON public.content_strategies
  FOR SELECT USING (workspace_id = public.current_workspace_id());

CREATE POLICY content_strategies_owner_insert ON public.content_strategies
  FOR INSERT WITH CHECK (workspace_id = public.current_workspace_id());

CREATE POLICY content_strategies_owner_update ON public.content_strategies
  FOR UPDATE USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

-- ─── content_plans ───────────────────────────────────────────────────────────
CREATE POLICY content_plans_owner_select ON public.content_plans
  FOR SELECT USING (workspace_id = public.current_workspace_id());

CREATE POLICY content_plans_owner_insert ON public.content_plans
  FOR INSERT WITH CHECK (workspace_id = public.current_workspace_id());

-- Updates go through service-role (agent); users can read but not mutate plan state.

-- ─── content_posts ───────────────────────────────────────────────────────────
CREATE POLICY content_posts_owner_select ON public.content_posts
  FOR SELECT USING (workspace_id = public.current_workspace_id());

CREATE POLICY content_posts_owner_insert ON public.content_posts
  FOR INSERT WITH CHECK (workspace_id = public.current_workspace_id());

CREATE POLICY content_posts_owner_update ON public.content_posts
  FOR UPDATE USING (workspace_id = public.current_workspace_id())
  WITH CHECK (workspace_id = public.current_workspace_id());

-- ─── content_post_versions ───────────────────────────────────────────────────
CREATE POLICY content_post_versions_owner_select ON public.content_post_versions
  FOR SELECT USING (workspace_id = public.current_workspace_id());

-- Versions are appended by the application layer; INSERT allowed from authenticated role.
CREATE POLICY content_post_versions_owner_insert ON public.content_post_versions
  FOR INSERT WITH CHECK (workspace_id = public.current_workspace_id());

-- No UPDATE/DELETE on versions — immutable audit trail.

-- ─── approval_events ─────────────────────────────────────────────────────────
CREATE POLICY approval_events_owner_select ON public.approval_events
  FOR SELECT USING (workspace_id = public.current_workspace_id());

CREATE POLICY approval_events_owner_insert ON public.approval_events
  FOR INSERT WITH CHECK (workspace_id = public.current_workspace_id());

-- No UPDATE/DELETE — approval events are an immutable audit trail.

-- ─── agent_jobs ──────────────────────────────────────────────────────────────
-- Users can read their workspace's jobs for the Activity page.
CREATE POLICY agent_jobs_owner_select ON public.agent_jobs
  FOR SELECT USING (workspace_id = public.current_workspace_id());

-- INSERT/UPDATE is done by service-role (worker); not client-writable.

-- ─── agent_job_attempts ──────────────────────────────────────────────────────
CREATE POLICY agent_job_attempts_owner_select ON public.agent_job_attempts
  FOR SELECT USING (workspace_id = public.current_workspace_id());

-- ─── audit_events ────────────────────────────────────────────────────────────
CREATE POLICY audit_events_owner_select ON public.audit_events
  FOR SELECT USING (workspace_id = public.current_workspace_id());

-- Audit events are INSERT-only via service-role; no client writes.

-- ─── telegram_links ──────────────────────────────────────────────────────────
CREATE POLICY telegram_links_owner_select ON public.telegram_links
  FOR SELECT USING (workspace_id = public.current_workspace_id());

-- ─── link_tokens ─────────────────────────────────────────────────────────────
-- Tokens are managed by service-role only; users can only read their own.
CREATE POLICY link_tokens_owner_select ON public.link_tokens
  FOR SELECT USING (user_id = auth.uid());

-- ─── mcp_credentials ─────────────────────────────────────────────────────────
CREATE POLICY mcp_credentials_owner_select ON public.mcp_credentials
  FOR SELECT USING (workspace_id = public.current_workspace_id());

-- ─── billing_customers ───────────────────────────────────────────────────────
CREATE POLICY billing_customers_owner_select ON public.billing_customers
  FOR SELECT USING (workspace_id = public.current_workspace_id());

-- ─── subscriptions ───────────────────────────────────────────────────────────
CREATE POLICY subscriptions_owner_select ON public.subscriptions
  FOR SELECT USING (workspace_id = public.current_workspace_id());

-- ─── usage_counters ──────────────────────────────────────────────────────────
CREATE POLICY usage_counters_owner_select ON public.usage_counters
  FOR SELECT USING (workspace_id = public.current_workspace_id());
