-- Telegram conversational content creation state and per-chat turn serialization.
ALTER TABLE public.telegram_links
  ADD COLUMN IF NOT EXISTS conversation_state JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS conversation_lock_token UUID,
  ADD COLUMN IF NOT EXISTS conversation_lock_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN public.telegram_links.conversation_state IS
  'Minimal Telegram content-session context. Draft text remains in content_posts; no full chat transcript is stored.';
COMMENT ON COLUMN public.telegram_links.conversation_lock_token IS
  'Short-lived fencing token serializing conversational turns for this linked private chat.';

CREATE OR REPLACE FUNCTION public.claim_telegram_conversation(
  p_telegram_user_id BIGINT, p_chat_id BIGINT, p_workspace_id UUID, p_lock_token UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_link public.telegram_links%ROWTYPE;
BEGIN
  SELECT * INTO v_link FROM public.telegram_links
   WHERE telegram_user_id = p_telegram_user_id AND chat_id = p_chat_id
     AND workspace_id = p_workspace_id AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'not_linked', 'state', '{}'::jsonb);
  END IF;
  IF v_link.conversation_lock_expires_at IS NOT NULL
     AND v_link.conversation_lock_expires_at > NOW() THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'busy', 'state', '{}'::jsonb);
  END IF;
  UPDATE public.telegram_links SET conversation_lock_token = p_lock_token,
    conversation_lock_expires_at = NOW() + INTERVAL '2 minutes' WHERE id = v_link.id;
  RETURN jsonb_build_object('claimed', true, 'state', COALESCE(v_link.conversation_state, '{}'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.release_telegram_conversation(
  p_telegram_user_id BIGINT, p_chat_id BIGINT, p_workspace_id UUID, p_lock_token UUID, p_state JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_updated INTEGER;
BEGIN
  UPDATE public.telegram_links SET conversation_state = COALESCE(p_state, '{}'::jsonb),
    conversation_lock_token = NULL, conversation_lock_expires_at = NULL
   WHERE telegram_user_id = p_telegram_user_id AND chat_id = p_chat_id
     AND workspace_id = p_workspace_id AND revoked_at IS NULL
     AND conversation_lock_token = p_lock_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_telegram_conversation(BIGINT, BIGINT, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_telegram_conversation(BIGINT, BIGINT, UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_telegram_conversation(BIGINT, BIGINT, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_telegram_conversation(BIGINT, BIGINT, UUID, UUID, JSONB) TO service_role;


-- Durable job provenance makes create/revision retries idempotent.
ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS telegram_job_id UUID REFERENCES public.agent_jobs(id) ON DELETE SET NULL;
ALTER TABLE public.content_post_versions
  ADD COLUMN IF NOT EXISTS telegram_job_id UUID REFERENCES public.agent_jobs(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS content_posts_telegram_job_unique
  ON public.content_posts (telegram_job_id)
  WHERE telegram_job_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS content_post_versions_telegram_job_unique
  ON public.content_post_versions (telegram_job_id)
  WHERE telegram_job_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.complete_telegram_conversation_job(
  p_telegram_user_id BIGINT,
  p_chat_id BIGINT,
  p_workspace_id UUID,
  p_job_id UUID,
  p_state JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE public.telegram_links
     SET conversation_state = COALESCE(p_state, '{}'::jsonb),
         conversation_lock_token = NULL,
         conversation_lock_expires_at = NULL
   WHERE telegram_user_id = p_telegram_user_id
     AND chat_id = p_chat_id
     AND workspace_id = p_workspace_id
     AND revoked_at IS NULL
     AND conversation_state->>'pendingJobId' = p_job_id::TEXT;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_telegram_conversation_job(BIGINT, BIGINT, UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_telegram_conversation_job(BIGINT, BIGINT, UUID, UUID, JSONB) TO service_role;


-- Enqueue and mark the chat as pending in one transaction. The worker cannot
-- claim a job before the corresponding pendingJobId is visible to it.
CREATE OR REPLACE FUNCTION public.enqueue_telegram_content_job(
  p_telegram_user_id BIGINT,
  p_chat_id BIGINT,
  p_workspace_id UUID,
  p_lock_token UUID,
  p_job_id UUID,
  p_idempotency_key TEXT,
  p_payload JSONB,
  p_conversation_state JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_link public.telegram_links%ROWTYPE;
  v_job_id UUID;
  v_status TEXT;
  v_inserted INTEGER;
BEGIN
  SELECT *
    INTO v_link
    FROM public.telegram_links
   WHERE telegram_user_id = p_telegram_user_id
     AND chat_id = p_chat_id
     AND workspace_id = p_workspace_id
     AND revoked_at IS NULL
     AND conversation_lock_token = p_lock_token
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('queued', false, 'reason', 'lock_lost');
  END IF;

  INSERT INTO public.agent_jobs (
    id, workspace_id, job_type, status, idempotency_key, payload,
    scheduled_for, attempt_count, max_attempts
  )
  VALUES (
    p_job_id, p_workspace_id, 'telegram_content_generation', 'queued',
    p_idempotency_key, COALESCE(p_payload, '{}'::jsonb), NOW(), 0, 3
  )
  ON CONFLICT (workspace_id, idempotency_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 1 THEN
    v_job_id := p_job_id;
    v_status := 'queued';
  ELSE
    SELECT id, status
      INTO v_job_id, v_status
      FROM public.agent_jobs
     WHERE workspace_id = p_workspace_id
       AND idempotency_key = p_idempotency_key;
  END IF;

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'Idempotent Telegram content job could not be recovered';
  END IF;

  IF v_status IN ('queued', 'running', 'failed_retryable') THEN
    UPDATE public.telegram_links
       SET conversation_state = COALESCE(p_conversation_state, '{}'::jsonb) ||
             jsonb_build_object('pendingJobId', v_job_id::TEXT, 'pendingSince', NOW()),
           conversation_lock_token = NULL,
           conversation_lock_expires_at = NULL
     WHERE id = v_link.id;

    RETURN jsonb_build_object('queued', true, 'job_id', v_job_id, 'status', v_status);
  END IF;

  UPDATE public.telegram_links
     SET conversation_lock_token = NULL,
         conversation_lock_expires_at = NULL
   WHERE id = v_link.id;

  RETURN jsonb_build_object(
    'queued', false,
    'reason', CASE WHEN v_status = 'succeeded' THEN 'already_completed' ELSE 'previous_failed' END,
    'job_id', v_job_id,
    'status', v_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_telegram_content_job(BIGINT, BIGINT, UUID, UUID, UUID, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_telegram_content_job(BIGINT, BIGINT, UUID, UUID, UUID, TEXT, JSONB, JSONB) TO service_role;
