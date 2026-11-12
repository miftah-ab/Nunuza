-- Approval atomically queues exactly one publish job. No job exists before owner approval.
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
  v_workspace_id UUID;
  v_updated INTEGER;
BEGIN
  IF v_user_id IS NULL OR p_draft_hash IS NULL OR p_draft_hash !~ '^[a-f0-9]{64}$' THEN
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
     AND a.draft_hash = p_draft_hash
     AND EXISTS (
       SELECT 1
         FROM public.integration_connections c
        WHERE c.workspace_id = a.workspace_id
          AND c.provider = 'linkedin'
          AND c.status = 'connected'
          AND 'w_member_social_feed' = ANY(COALESCE(c.granted_scopes, ARRAY[]::TEXT[]))
     )
  RETURNING a.workspace_id INTO v_workspace_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN RETURN FALSE; END IF;

  INSERT INTO public.agent_jobs(
    workspace_id, job_type, status, idempotency_key, payload,
    scheduled_for, attempt_count, max_attempts
  ) VALUES (
    v_workspace_id, 'publish_engagement_action', 'queued',
    'engagement-publish-' || p_action_id::text,
    jsonb_build_object('actionId', p_action_id::text, 'workspaceId', v_workspace_id::text),
    NOW(), 0, 1
  ) ON CONFLICT (workspace_id, idempotency_key) DO NOTHING;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_engagement_action_telegram(
  p_action_id UUID,
  p_telegram_user_id BIGINT,
  p_chat_id BIGINT,
  p_draft_hash_prefix TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_workspace_id UUID;
  v_owner UUID;
  v_updated INTEGER;
BEGIN
  IF p_draft_hash_prefix IS NULL OR p_draft_hash_prefix !~ '^[a-f0-9]{15}$' THEN
    RETURN FALSE;
  END IF;

  SELECT w.id, w.owner_user_id
    INTO v_workspace_id, v_owner
    FROM public.telegram_links tl
    JOIN public.workspaces w ON w.id = tl.workspace_id
   WHERE tl.telegram_user_id = p_telegram_user_id
     AND tl.chat_id = p_chat_id
     AND tl.revoked_at IS NULL
   LIMIT 1;

  IF v_workspace_id IS NULL OR v_owner IS NULL THEN RETURN FALSE; END IF;

  UPDATE public.engagement_actions a
     SET status = 'approved',
         approval_hash = a.draft_hash,
         approved_by = v_owner,
         approved_at = NOW(),
         updated_at = NOW()
   WHERE a.id = p_action_id
     AND a.workspace_id = v_workspace_id
     AND a.status = 'awaiting_approval'
     AND a.expires_at > NOW()
     AND left(a.draft_hash, 15) = p_draft_hash_prefix
     AND EXISTS (
       SELECT 1
         FROM public.integration_connections c
        WHERE c.workspace_id = v_workspace_id
          AND c.provider = 'linkedin'
          AND c.status = 'connected'
          AND 'w_member_social_feed' = ANY(COALESCE(c.granted_scopes, ARRAY[]::TEXT[]))
     );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN RETURN FALSE; END IF;

  INSERT INTO public.agent_jobs(
    workspace_id, job_type, status, idempotency_key, payload,
    scheduled_for, attempt_count, max_attempts
  ) VALUES (
    v_workspace_id, 'publish_engagement_action', 'queued',
    'engagement-publish-' || p_action_id::text,
    jsonb_build_object('actionId', p_action_id::text, 'workspaceId', v_workspace_id::text),
    NOW(), 0, 1
  ) ON CONFLICT (workspace_id, idempotency_key) DO NOTHING;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_engagement_action_telegram(
  p_action_id UUID,
  p_telegram_user_id BIGINT,
  p_chat_id BIGINT,
  p_draft_hash_prefix TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_workspace_id UUID;
  v_owner UUID;
  v_updated INTEGER;
BEGIN
  IF p_draft_hash_prefix IS NULL OR p_draft_hash_prefix !~ '^[a-f0-9]{15}$' THEN
    RETURN FALSE;
  END IF;

  SELECT w.id, w.owner_user_id
    INTO v_workspace_id, v_owner
    FROM public.telegram_links tl
    JOIN public.workspaces w ON w.id = tl.workspace_id
   WHERE tl.telegram_user_id = p_telegram_user_id
     AND tl.chat_id = p_chat_id
     AND tl.revoked_at IS NULL
   LIMIT 1;

  IF v_workspace_id IS NULL OR v_owner IS NULL THEN RETURN FALSE; END IF;

  UPDATE public.engagement_actions a
     SET status = 'rejected',
         rejected_by = v_owner,
         rejected_at = NOW(),
         updated_at = NOW()
   WHERE a.id = p_action_id
     AND a.workspace_id = v_workspace_id
     AND a.status = 'awaiting_approval'
     AND a.expires_at > NOW()
     AND left(a.draft_hash, 15) = p_draft_hash_prefix;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_engagement_action_telegram(UUID, BIGINT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_engagement_action_telegram(UUID, BIGINT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_engagement_action_telegram(UUID, BIGINT, BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_engagement_action_telegram(UUID, BIGINT, BIGINT, TEXT) TO service_role;
