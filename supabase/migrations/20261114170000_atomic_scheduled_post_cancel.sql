-- Cancel a scheduled LinkedIn post only while its durable job is still
-- claimable. Locking the job row serializes this operation with
-- claim_due_agent_jobs(), so a worker and a user cannot both win.
CREATE OR REPLACE FUNCTION public.cancel_scheduled_post_atomic(
  p_workspace_id UUID,
  p_post_id UUID
)
RETURNS TABLE(success BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post_status TEXT;
  v_job_id UUID;
  v_job_status TEXT;
BEGIN
  IF p_workspace_id IS NULL OR p_post_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id and post_id are required';
  END IF;

  SELECT p.status::TEXT
    INTO v_post_status
    FROM public.content_posts AS p
   WHERE p.id = p_post_id
     AND p.workspace_id = p_workspace_id
   FOR UPDATE;

  IF NOT FOUND OR v_post_status <> 'scheduled' THEN
    RETURN QUERY SELECT FALSE, 'POST_NOT_SCHEDULED'::TEXT;
    RETURN;
  END IF;

  SELECT j.id, j.status::TEXT
    INTO v_job_id, v_job_status
    FROM public.agent_jobs AS j
   WHERE j.workspace_id = p_workspace_id
     AND j.job_type = 'publish_post'
     AND j.idempotency_key = 'publish-' || p_workspace_id::TEXT || '-' || p_post_id::TEXT
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'PUBLISH_JOB_NOT_FOUND'::TEXT;
    RETURN;
  END IF;

  -- claim_due_agent_jobs() can only claim queued/failed_retryable jobs.
  -- waiting_for_approval is also safe to cancel. Running, succeeded,
  -- failed_terminal, canceled, and needs_reconciliation are never reset.
  IF v_job_status NOT IN ('queued', 'failed_retryable', 'waiting_for_approval') THEN
    RETURN QUERY SELECT FALSE, 'JOB_NOT_CANCELLABLE'::TEXT;
    RETURN;
  END IF;

  UPDATE public.agent_jobs
     SET status = 'canceled',
         finished_at = NOW(),
         lease_until = NULL,
         last_error_code = 'USER_CANCELED',
         safe_error_message = 'Scheduled post canceled by user.',
         updated_at = NOW()
   WHERE id = v_job_id
     AND status::TEXT = v_job_status;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'JOB_STATE_CHANGED'::TEXT;
    RETURN;
  END IF;

  UPDATE public.content_posts
     SET status = 'approved',
         scheduled_at = NULL,
         updated_at = NOW()
   WHERE id = p_post_id
     AND workspace_id = p_workspace_id
     AND status = 'scheduled';

  IF NOT FOUND THEN
    -- Raising rolls back the job cancellation too; never leave half a cancel.
    RAISE EXCEPTION 'scheduled post changed during cancellation';
  END IF;

  RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_scheduled_post_atomic(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_scheduled_post_atomic(UUID, UUID)
  TO service_role;
