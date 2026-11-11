-- Nunuza autonomous agent cycle: idempotent output linkage.
-- Reuses the existing content_posts, agent_jobs, and audit_events tables.
-- One nullable key is enough to make a generated post safe across worker retries.
ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS agent_cycle_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS content_posts_workspace_agent_cycle_key_uidx
  ON public.content_posts (workspace_id, agent_cycle_key)
  WHERE agent_cycle_key IS NOT NULL;

COMMENT ON COLUMN public.content_posts.agent_cycle_key IS
  'Deterministic workspace-scoped autonomous cycle key. Prevents duplicate agent-created posts after worker retries.';
