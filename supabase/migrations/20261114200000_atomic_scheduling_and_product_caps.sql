-- Restore the product-spec publishing ceilings and make scheduling a single
-- transaction across the approved post and its durable publishing job.

UPDATE public.workspaces
   SET max_posts_per_day = LEAST(max_posts_per_day, 1),
       max_posts_per_7_days = LEAST(max_posts_per_7_days, 7);

ALTER TABLE public.workspaces
  ALTER COLUMN max_posts_per_day SET DEFAULT 1,
  ALTER COLUMN max_posts_per_7_days SET DEFAULT 7,
  DROP CONSTRAINT IF EXISTS workspaces_daily_publish_limit_check,
  DROP CONSTRAINT IF EXISTS workspaces_weekly_publish_limit_check,
  DROP CONSTRAINT IF EXISTS workspaces_weekly_limit_gte_daily_check;

ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_daily_publish_limit_check
    CHECK (max_posts_per_day BETWEEN 0 AND 1),
  ADD CONSTRAINT workspaces_weekly_publish_limit_check
    CHECK (max_posts_per_7_days BETWEEN 0 AND 7),
  ADD CONSTRAINT workspaces_weekly_limit_gte_daily_check
    CHECK (max_posts_per_7_days >= max_posts_per_day);

COMMENT ON COLUMN public.workspaces.max_posts_per_day IS
  'Workspace-selected maximum Nunuza-scheduled LinkedIn posts per UTC calendar day (0-1; product ceiling 1).';
COMMENT ON COLUMN public.workspaces.max_posts_per_7_days IS
  'Workspace-selected maximum Nunuza-scheduled LinkedIn posts in any rolling 7-day period (0-7; product ceiling 7).';

CREATE OR REPLACE FUNCTION public.schedule_post_atomic(
  p_workspace_id UUID,
  p_post_id UUID,
  p_owner_user_id UUID,
  p_scheduled_for TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_workspace public.workspaces%ROWTYPE;
  v_post public.content_posts%ROWTYPE;
  v_job public.agent_jobs%ROWTYPE;
  v_job_exists BOOLEAN := FALSE;
  v_idempotency_key TEXT;
  v_payload JSONB;
  v_day_start TIMESTAMPTZ;
  v_day_end TIMESTAMPTZ;
  v_daily_count INTEGER := 0;
  v_weekly_count INTEGER := 0;
BEGIN
  IF p_workspace_id IS NULL OR p_post_id IS NULL OR p_owner_user_id IS NULL
     OR p_scheduled_for IS NULL OR p_scheduled_for < NOW() - INTERVAL '60 seconds' THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'INVALID_SCHEDULE_TIME');
  END IF;

  -- This workspace lock serializes concurrent schedule requests for this
  -- LinkedIn profile, including daily/rolling-window capacity checks.
  SELECT * INTO v_workspace
    FROM public.workspaces
   WHERE id = p_workspace_id
   FOR UPDATE;

  IF NOT FOUND OR v_workspace.owner_user_id IS DISTINCT FROM p_owner_user_id THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'WORKSPACE_ACCESS_DENIED');
  END IF;

  IF v_workspace.entitlement_type::TEXT NOT IN ('internal_beta', 'paid_trial', 'paid_active') THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'ENTITLEMENT_REQUIRED');
  END IF;
  IF v_workspace.paused_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'WORKSPACE_PAUSED');
  END IF;

  SELECT * INTO v_post
    FROM public.content_posts
   WHERE id = p_post_id AND workspace_id = p_workspace_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'POST_NOT_FOUND');
  END IF;
  IF v_post.status <> 'approved' THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'POST_NOT_APPROVED');
  END IF;

  v_day_start := date_trunc('day', p_scheduled_for AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_day_end := v_day_start + INTERVAL '1 day';

  SELECT COUNT(*)::INTEGER INTO v_daily_count
    FROM public.content_posts AS p
   WHERE p.workspace_id = p_workspace_id
     AND p.id <> p_post_id
     AND (
       (p.status = 'scheduled' AND p.scheduled_at >= v_day_start AND p.scheduled_at < v_day_end)
       OR (p.status = 'published' AND p.published_at >= v_day_start AND p.published_at < v_day_end)
       OR (p.status IN ('publishing', 'needs_reconciliation') AND p.updated_at >= v_day_start AND p.updated_at < v_day_end)
     );

  IF v_daily_count >= v_workspace.max_posts_per_day THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'DAILY_CAP_REACHED');
  END IF;

  -- Any already-scheduled post within seven days before OR after the proposed
  -- instant can share a rolling seven-day window with this post.
  SELECT COUNT(*)::INTEGER INTO v_weekly_count
    FROM public.content_posts AS p
   WHERE p.workspace_id = p_workspace_id
     AND p.id <> p_post_id
     AND (
       (p.status = 'scheduled'
         AND p.scheduled_at > p_scheduled_for - INTERVAL '7 days'
         AND p.scheduled_at < p_scheduled_for + INTERVAL '7 days')
       OR (p.status = 'published'
         AND p.published_at > p_scheduled_for - INTERVAL '7 days'
         AND p.published_at <= p_scheduled_for)
       OR (p.status IN ('publishing', 'needs_reconciliation')
         AND p.updated_at > p_scheduled_for - INTERVAL '7 days'
         AND p.updated_at <= NOW())
     );

  IF v_weekly_count >= v_workspace.max_posts_per_7_days THEN
    RETURN jsonb_build_object('success', FALSE, 'reason', 'WEEKLY_CAP_REACHED');
  END IF;

  v_idempotency_key := 'publish-' || p_workspace_id::TEXT || '-' || p_post_id::TEXT;
  v_payload := jsonb_build_object(
    'postId', p_post_id,
    'workspaceId', p_workspace_id,
    'userId', p_owner_user_id,
    'targetProvider', 'linkedin',
    'scheduledFor', p_scheduled_for
  );

  SELECT * INTO v_job
    FROM public.agent_jobs
   WHERE workspace_id = p_workspace_id
     AND idempotency_key = v_idempotency_key
   FOR UPDATE;
  v_job_exists := FOUND;

  IF v_job_exists THEN
    IF v_job.job_type <> 'publish_post' THEN
      RETURN jsonb_build_object('success', FALSE, 'reason', 'IDEMPOTENCY_KEY_CONFLICT');
    END IF;

    IF v_job.status::TEXT NOT IN ('queued', 'canceled', 'failed_retryable') THEN
      RETURN jsonb_build_object('success', FALSE, 'reason', 'JOB_STATE_NOT_RESCHEDULABLE');
    END IF;
    IF v_job.attempt_count >= v_job.max_attempts THEN
      RETURN jsonb_build_object('success', FALSE, 'reason', 'JOB_ATTEMPTS_EXHAUSTED');
    END IF;

    UPDATE public.agent_jobs
       SET status = 'queued',
           payload = v_payload,
           scheduled_for = p_scheduled_for,
           started_at = NULL,
           finished_at = NULL,
           lease_until = NULL,
           last_error_code = NULL,
           safe_error_message = NULL,
           updated_at = NOW()
     WHERE id = v_job.id
     RETURNING * INTO v_job;
  ELSE
    INSERT INTO public.agent_jobs(
      workspace_id, job_type, status, idempotency_key, payload,
      scheduled_for, attempt_count, max_attempts
    ) VALUES (
      p_workspace_id, 'publish_post', 'queued', v_idempotency_key, v_payload,
      p_scheduled_for, 0, 3
    ) RETURNING * INTO v_job;
  END IF;

  UPDATE public.content_posts
     SET status = 'scheduled',
         scheduled_at = p_scheduled_for,
         updated_at = NOW()
   WHERE id = p_post_id
     AND workspace_id = p_workspace_id
     AND status = 'approved'
  RETURNING * INTO v_post;

  IF NOT FOUND THEN
    -- Raise so the job mutation is rolled back with the post update.
    RAISE EXCEPTION 'Approved post changed during atomic scheduling';
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'job', to_jsonb(v_job),
    'post', to_jsonb(v_post)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.schedule_post_atomic(UUID, UUID, UUID, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_post_atomic(UUID, UUID, UUID, TIMESTAMPTZ)
  TO service_role;
