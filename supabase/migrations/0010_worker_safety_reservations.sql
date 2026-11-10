-- Consolidated worker safety functions: atomic workspace posting slots and draft usage reservations.
-- Uses existing workspaces, content_posts, and usage_counters tables; no new tables.

CREATE OR REPLACE FUNCTION public.claim_workspace_publish_slot(
  p_workspace_id UUID,
  p_post_id UUID
)
RETURNS TABLE(allowed BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_day_start TIMESTAMPTZ;
  v_day_end TIMESTAMPTZ;
  v_week_start TIMESTAMPTZ;
  v_daily_count INTEGER;
  v_weekly_count INTEGER;
  v_post_status public.post_status;
BEGIN
  IF p_workspace_id IS NULL OR p_post_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id and post_id are required';
  END IF;

  -- Serialize every publish attempt for a workspace. The first claimant changes
  -- its post to publishing, which reserves the slot for subsequent claimants.
  PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'WORKSPACE_NOT_FOUND'::TEXT;
    RETURN;
  END IF;

  SELECT status INTO v_post_status
    FROM public.content_posts
   WHERE id = p_post_id AND workspace_id = p_workspace_id
   FOR UPDATE;

  IF NOT FOUND OR v_post_status NOT IN ('approved', 'scheduled') THEN
    RETURN QUERY SELECT FALSE, 'POST_NOT_ELIGIBLE'::TEXT;
    RETURN;
  END IF;

  v_day_start := date_trunc('day', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_day_end := v_day_start + INTERVAL '1 day';
  v_week_start := v_now - INTERVAL '7 days';

  SELECT COUNT(*) INTO v_daily_count
    FROM public.content_posts p
   WHERE p.workspace_id = p_workspace_id
     AND p.id <> p_post_id
     AND (
       (p.status = 'published' AND p.published_at >= v_day_start AND p.published_at < v_day_end)
       OR (p.status IN ('publishing', 'needs_reconciliation') AND p.updated_at >= v_day_start AND p.updated_at < v_day_end)
       OR (p.status = 'scheduled' AND p.scheduled_at >= v_day_start AND p.scheduled_at < v_day_end)
     );

  IF v_daily_count >= 1 THEN
    RETURN QUERY SELECT FALSE, 'DAILY_CAP_REACHED'::TEXT;
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_weekly_count
    FROM public.content_posts p
   WHERE p.workspace_id = p_workspace_id
     AND p.id <> p_post_id
     AND (
       (p.status = 'published' AND p.published_at >= v_week_start AND p.published_at <= v_now)
       OR (p.status IN ('publishing', 'needs_reconciliation') AND p.updated_at >= v_week_start AND p.updated_at <= v_now)
       OR (p.status = 'scheduled' AND p.scheduled_at >= v_week_start AND p.scheduled_at <= v_now + INTERVAL '7 days')
     );

  IF v_weekly_count >= 7 THEN
    RETURN QUERY SELECT FALSE, 'WEEKLY_CAP_REACHED'::TEXT;
    RETURN;
  END IF;

  UPDATE public.content_posts
     SET status = 'publishing', updated_at = v_now
   WHERE id = p_post_id AND workspace_id = p_workspace_id
     AND status = v_post_status;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'POST_ALREADY_CLAIMED'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_draft_usage(
  p_job_id UUID,
  p_workspace_id UUID,
  p_period_start DATE,
  p_period_end DATE,
  p_limit INTEGER DEFAULT 30
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_count INTEGER;
  v_job_workspace UUID;
  v_payload JSONB;
  v_reserved_period DATE;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'p_limit must be positive';
  END IF;

  SELECT workspace_id, payload INTO v_job_workspace, v_payload
    FROM public.agent_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job_workspace <> p_workspace_id THEN
    RAISE EXCEPTION 'agent job does not belong to the requested workspace';
  END IF;

  IF v_payload ? 'draft_usage_reserved_period' THEN
    v_reserved_period := (v_payload->>'draft_usage_reserved_period')::DATE;
    IF v_reserved_period = p_period_start THEN
      RETURN TRUE;
    END IF;
    UPDATE public.usage_counters
       SET count = GREATEST(count - 1, 0), updated_at = NOW()
     WHERE workspace_id = p_workspace_id
       AND metric = 'draft_items_created'
       AND period_start = v_reserved_period;
  END IF;

  INSERT INTO public.usage_counters (workspace_id, metric, period_start, period_end, count)
  VALUES (p_workspace_id, 'draft_items_created', p_period_start, p_period_end, 1)
  ON CONFLICT (workspace_id, metric, period_start)
  DO UPDATE SET
    count = public.usage_counters.count + 1,
    period_end = EXCLUDED.period_end,
    updated_at = NOW()
  WHERE public.usage_counters.count < p_limit
  RETURNING count INTO v_count;

  IF v_count IS NULL THEN
    UPDATE public.agent_jobs
       SET payload = payload - 'draft_usage_reserved_period', updated_at = NOW()
     WHERE id = p_job_id;
    RETURN FALSE;
  END IF;

  UPDATE public.agent_jobs
     SET payload = jsonb_set(payload, '{draft_usage_reserved_period}', to_jsonb(p_period_start::TEXT), TRUE),
         updated_at = NOW()
   WHERE id = p_job_id;
  RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_draft_usage(p_job_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_workspace_id UUID;
  v_payload JSONB;
  v_period_start DATE;
  v_cycle_date TEXT;
BEGIN
  SELECT workspace_id, payload INTO v_workspace_id, v_payload
    FROM public.agent_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR NOT (v_payload ? 'draft_usage_reserved_period') THEN
    RETURN;
  END IF;

  -- A response can be lost after the post INSERT committed. In that case the
  -- cycle key proves usage was consumed; only clear the reservation marker.
  v_cycle_date := v_payload->>'cycleDate';
  IF v_cycle_date IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.content_posts
     WHERE workspace_id = v_workspace_id
       AND agent_cycle_key = v_workspace_id::TEXT || ':' || v_cycle_date
  ) THEN
    UPDATE public.agent_jobs
       SET payload = payload - 'draft_usage_reserved_period', updated_at = NOW()
     WHERE id = p_job_id;
    RETURN;
  END IF;

  v_period_start := (v_payload->>'draft_usage_reserved_period')::DATE;
  UPDATE public.usage_counters
     SET count = GREATEST(count - 1, 0), updated_at = NOW()
   WHERE workspace_id = v_workspace_id
     AND metric = 'draft_items_created'
     AND period_start = v_period_start;

  UPDATE public.agent_jobs
     SET payload = payload - 'draft_usage_reserved_period', updated_at = NOW()
   WHERE id = p_job_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.claim_workspace_publish_slot(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_draft_usage(UUID, UUID, DATE, DATE, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_draft_usage(UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_workspace_publish_slot(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_draft_usage(UUID, UUID, DATE, DATE, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_draft_usage(UUID) TO service_role;


-- The cron-level check is an optimization; this index is the concurrency guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS agent_jobs_one_active_cycle_per_workspace_uidx
  ON public.agent_jobs (workspace_id)
  WHERE job_type = 'agent_cycle'
    AND status IN ('queued', 'running', 'failed_retryable');
