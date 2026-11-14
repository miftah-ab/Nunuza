-- Configurable, workspace-scoped LinkedIn publishing limits.
-- Defaults allow a professional high-volume workflow while retaining a weekly guardrail.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS max_posts_per_day INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS max_posts_per_7_days INTEGER NOT NULL DEFAULT 50;

ALTER TABLE public.workspaces
  DROP CONSTRAINT IF EXISTS workspaces_daily_publish_limit_check,
  DROP CONSTRAINT IF EXISTS workspaces_weekly_publish_limit_check,
  DROP CONSTRAINT IF EXISTS workspaces_weekly_limit_gte_daily_check;

ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_daily_publish_limit_check
    CHECK (max_posts_per_day BETWEEN 1 AND 10),
  ADD CONSTRAINT workspaces_weekly_publish_limit_check
    CHECK (max_posts_per_7_days BETWEEN 1 AND 50),
  ADD CONSTRAINT workspaces_weekly_limit_gte_daily_check
    CHECK (max_posts_per_7_days >= max_posts_per_day);

COMMENT ON COLUMN public.workspaces.max_posts_per_day IS
  'Workspace-configured maximum LinkedIn posts per UTC calendar day (1-10).';
COMMENT ON COLUMN public.workspaces.max_posts_per_7_days IS
  'Workspace-configured maximum LinkedIn posts in a rolling 7-day window (daily limit-50).';

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
  v_daily_limit INTEGER;
  v_weekly_limit INTEGER;
  v_post_status public.post_status;
BEGIN
  IF p_workspace_id IS NULL OR p_post_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id and post_id are required';
  END IF;

  -- Lock the workspace row so concurrent publishers serialize limit checks.
  SELECT max_posts_per_day, max_posts_per_7_days
    INTO v_daily_limit, v_weekly_limit
    FROM public.workspaces
   WHERE id = p_workspace_id
   FOR UPDATE;

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

  IF v_daily_count >= v_daily_limit THEN
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

  IF v_weekly_count >= v_weekly_limit THEN
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
