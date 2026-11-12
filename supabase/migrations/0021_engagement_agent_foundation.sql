-- Engagement Agent: durable, approval-bound conversation actions.
-- Discovery and provider publishing remain gated by LinkedIn's granted API permissions.

CREATE TABLE public.engagement_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('comment', 'reply')),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('external_post', 'own_post_comment', 'other_comment')),
  provider TEXT NOT NULL DEFAULT 'linkedin' CHECK (provider = 'linkedin'),
  -- Stable LinkedIn identifiers. For replies, both parent_post_urn and parent_comment_urn are required.
  target_post_urn TEXT NOT NULL,
  parent_post_urn TEXT,
  parent_comment_urn TEXT,
  source_comment_urn TEXT,
  source_author_urn TEXT,
  source_text TEXT,
  draft_text TEXT NOT NULL CHECK (char_length(draft_text) BETWEEN 1 AND 3000),
  draft_hash TEXT NOT NULL CHECK (draft_hash ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'awaiting_approval'
    CHECK (status IN (
      'discovered', 'drafted', 'awaiting_approval', 'approved', 'rejected',
      'expired', 'publishing', 'published', 'failed', 'needs_reconciliation', 'ignored'
    )),
  approval_hash TEXT,
  approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '48 hours'),
  published_comment_urn TEXT,
  published_at TIMESTAMPTZ,
  failure_code TEXT,
  safe_failure_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT engagement_reply_thread_required CHECK (
    action_type <> 'reply' OR
    (parent_post_urn IS NOT NULL AND parent_comment_urn IS NOT NULL)
  ),
  CONSTRAINT engagement_published_reference_required CHECK (
    status <> 'published' OR
    (published_comment_urn IS NOT NULL AND published_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX engagement_actions_source_once
  ON public.engagement_actions(workspace_id, provider, action_type, source_comment_urn)
  WHERE source_comment_urn IS NOT NULL;
CREATE UNIQUE INDEX engagement_actions_publish_urn_unique
  ON public.engagement_actions(published_comment_urn)
  WHERE published_comment_urn IS NOT NULL;
CREATE INDEX engagement_actions_inbox
  ON public.engagement_actions(workspace_id, status, created_at DESC);
CREATE INDEX engagement_actions_expiry
  ON public.engagement_actions(expires_at)
  WHERE status = 'awaiting_approval';

ALTER TABLE public.engagement_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_actions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.engagement_actions TO service_role;


-- Engagement runs only after the workspace owner explicitly enables it.
CREATE TABLE public.engagement_settings (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  daily_limit SMALLINT NOT NULL DEFAULT 5 CHECK (daily_limit BETWEEN 1 AND 30),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.engagement_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.engagement_settings TO service_role;

CREATE OR REPLACE FUNCTION public.update_engagement_settings(
  p_workspace_id UUID,
  p_enabled BOOLEAN,
  p_daily_limit INTEGER
) RETURNS public.engagement_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_settings public.engagement_settings;
BEGIN
  IF v_user_id IS NULL OR p_workspace_id IS NULL OR p_enabled IS NULL OR p_daily_limit < 1 OR p_daily_limit > 30 THEN
    RAISE EXCEPTION 'Invalid engagement settings.';
  END IF;
  INSERT INTO public.engagement_settings(workspace_id, enabled, daily_limit)
  SELECT id, p_enabled, p_daily_limit
    FROM public.workspaces
   WHERE id = p_workspace_id AND owner_user_id = v_user_id
  ON CONFLICT (workspace_id) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        daily_limit = EXCLUDED.daily_limit,
        updated_at = NOW()
  RETURNING * INTO v_settings;
  IF v_settings.workspace_id IS NULL THEN
    RAISE EXCEPTION 'Workspace not found.';
  END IF;
  RETURN v_settings;
END;
$$;

REVOKE ALL ON FUNCTION public.update_engagement_settings(UUID, BOOLEAN, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_engagement_settings(UUID, BOOLEAN, INTEGER) TO authenticated;

-- Approval is bound to the exact draft hash. Editing a draft requires a new approval.
-- Only the workspace owner may approve/reject, and notifications never confer authority.
CREATE OR REPLACE FUNCTION public.approve_engagement_action(
  p_action_id UUID,
  p_draft_hash TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_updated INTEGER;
BEGIN
  IF v_user_id IS NULL OR p_draft_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN FALSE;
  END IF;

  UPDATE public.engagement_actions a
     SET status = 'approved',
         approval_hash = p_draft_hash,
         approved_by = v_user_id,
         approved_at = NOW(),
         updated_at = NOW()
    FROM public.workspaces w
   WHERE a.id = p_action_id
     AND w.id = a.workspace_id
     AND w.owner_user_id = v_user_id
     AND a.status = 'awaiting_approval'
     AND a.expires_at > NOW()
     AND a.draft_hash = p_draft_hash;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_engagement_action(
  p_action_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_updated INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE public.engagement_actions a
     SET status = 'rejected',
         rejected_by = v_user_id,
         rejected_at = NOW(),
         updated_at = NOW()
    FROM public.workspaces w
   WHERE a.id = p_action_id
     AND w.id = a.workspace_id
     AND w.owner_user_id = v_user_id
     AND a.status = 'awaiting_approval'
     AND a.expires_at > NOW();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_engagement_action(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_engagement_action(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_engagement_action(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_engagement_action(UUID) TO authenticated;
