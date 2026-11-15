-- Atomic monthly draft quota reservation and creation.
-- Active reservations count against the same monthly allowance as committed drafts.
-- Expired reservations are cleaned on the next reservation attempt, so a crashed
-- request cannot permanently consume quota.

CREATE TABLE IF NOT EXISTS public.draft_usage_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  metric TEXT NOT NULL DEFAULT 'draft_items_created',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'committed', 'released')),
  post_id UUID REFERENCES public.content_posts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT draft_usage_reservations_period_valid CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS draft_usage_reservations_active_idx
  ON public.draft_usage_reservations(workspace_id, period_start, expires_at);

ALTER TABLE public.draft_usage_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.draft_usage_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.draft_usage_reservations TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_draft_usage_slot(
  p_workspace_id UUID,
  p_owner_user_id UUID,
  p_period_start DATE,
  p_period_end DATE,
  p_limit INTEGER DEFAULT 30,
  p_metric TEXT DEFAULT 'draft_items_created'
)
RETURNS TABLE(allowed BOOLEAN, reservation_id UUID, current_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_used INTEGER := 0;
  v_reserved INTEGER := 0;
  v_reservation UUID;
BEGIN
  IF p_workspace_id IS NULL OR p_owner_user_id IS NULL
     OR p_period_start IS NULL OR p_period_end IS NULL
     OR p_period_end < p_period_start OR p_limit IS NULL OR p_limit < 1
     OR p_metric IS NULL OR p_metric NOT LIKE 'draft_items_created%' THEN
    RAISE EXCEPTION 'Invalid draft usage reservation arguments';
  END IF;

  -- Serialize all reservations and commits for this workspace.
  SELECT owner_user_id INTO v_owner
    FROM public.workspaces
   WHERE id = p_workspace_id
   FOR UPDATE;
  IF NOT FOUND OR v_owner IS DISTINCT FROM p_owner_user_id THEN
    RAISE EXCEPTION 'Workspace owner verification failed';
  END IF;

  DELETE FROM public.draft_usage_reservations
   WHERE workspace_id = p_workspace_id
     AND status <> 'reserved'
     AND created_at < NOW() - INTERVAL '90 days';

  UPDATE public.draft_usage_reservations
     SET status = 'released'
   WHERE workspace_id = p_workspace_id
     AND period_start = p_period_start
     AND metric = p_metric
     AND status = 'reserved'
     AND expires_at <= NOW();

  SELECT COALESCE(MAX(count), 0)::INTEGER INTO v_used
    FROM public.usage_counters
   WHERE workspace_id = p_workspace_id
     AND metric = p_metric
     AND period_start = p_period_start;

  SELECT COUNT(*)::INTEGER INTO v_reserved
    FROM public.draft_usage_reservations
   WHERE workspace_id = p_workspace_id
     AND period_start = p_period_start
     AND metric = p_metric
     AND status = 'reserved'
     AND expires_at > NOW();

  IF v_used + v_reserved >= p_limit THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, v_used + v_reserved;
    RETURN;
  END IF;

  INSERT INTO public.draft_usage_reservations(
    workspace_id, owner_user_id, period_start, period_end, metric
  ) VALUES (
    p_workspace_id, p_owner_user_id, p_period_start, p_period_end, p_metric
  ) RETURNING id INTO v_reservation;

  RETURN QUERY SELECT TRUE, v_reservation, v_used + v_reserved + 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_draft_with_usage(
  p_reservation_id UUID,
  p_workspace_id UUID,
  p_owner_user_id UUID,
  p_text TEXT,
  p_internal_title TEXT DEFAULT NULL,
  p_pillar TEXT DEFAULT NULL,
  p_source_notes TEXT DEFAULT NULL,
  p_status public.post_status DEFAULT 'draft'
)
RETURNS public.content_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_reservation public.draft_usage_reservations%ROWTYPE;
  v_post public.content_posts%ROWTYPE;
BEGIN
  IF p_text IS NULL OR length(btrim(p_text)) = 0 OR char_length(p_text) > 3000 THEN
    RAISE EXCEPTION 'Draft text must contain 1 to 3000 characters';
  END IF;
  IF p_status NOT IN ('draft', 'needs_review') THEN
    RAISE EXCEPTION 'Only draft and needs_review statuses may be created';
  END IF;

  SELECT owner_user_id INTO v_owner
    FROM public.workspaces
   WHERE id = p_workspace_id
   FOR UPDATE;
  IF NOT FOUND OR v_owner IS DISTINCT FROM p_owner_user_id THEN
    RAISE EXCEPTION 'Workspace owner verification failed';
  END IF;

  SELECT * INTO v_reservation
    FROM public.draft_usage_reservations
   WHERE id = p_reservation_id
     AND workspace_id = p_workspace_id
     AND owner_user_id = p_owner_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draft usage reservation is missing or expired';
  END IF;

  -- A retry after a lost HTTP response returns the already-created post.
  IF v_reservation.status = 'committed' AND v_reservation.post_id IS NOT NULL THEN
    SELECT * INTO v_post FROM public.content_posts WHERE id = v_reservation.post_id;
    IF FOUND THEN RETURN v_post; END IF;
    RAISE EXCEPTION 'Committed draft reservation has no corresponding post';
  END IF;
  IF v_reservation.status <> 'reserved' OR v_reservation.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Draft usage reservation is missing or expired';
  END IF;

  INSERT INTO public.content_posts(
    workspace_id, created_by, text, internal_title, pillar, source_notes,
    status, version
  ) VALUES (
    p_workspace_id, p_owner_user_id, p_text, p_internal_title, p_pillar,
    p_source_notes, p_status, 1
  ) RETURNING * INTO v_post;

  INSERT INTO public.content_post_versions(
    workspace_id, post_id, version_number, text, change_source, changed_by
  ) VALUES (
    p_workspace_id, v_post.id, 1, p_text, 'user_edit', p_owner_user_id
  );

  INSERT INTO public.usage_counters(
    workspace_id, metric, period_start, period_end, count
  ) VALUES (
    p_workspace_id, v_reservation.metric, v_reservation.period_start,
    v_reservation.period_end, 1
  )
  ON CONFLICT (workspace_id, metric, period_start)
  DO UPDATE SET
    count = public.usage_counters.count + 1,
    period_end = EXCLUDED.period_end,
    updated_at = NOW();

  UPDATE public.draft_usage_reservations
     SET status = 'committed',
         post_id = v_post.id,
         expires_at = NOW()
   WHERE id = p_reservation_id;
  RETURN v_post;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_draft_usage_slot(
  p_reservation_id UUID,
  p_workspace_id UUID,
  p_owner_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_deleted INTEGER;
BEGIN
  SELECT owner_user_id INTO v_owner
    FROM public.workspaces
   WHERE id = p_workspace_id
   FOR UPDATE;
  IF NOT FOUND OR v_owner IS DISTINCT FROM p_owner_user_id THEN
    RAISE EXCEPTION 'Workspace owner verification failed';
  END IF;

  UPDATE public.draft_usage_reservations
     SET status = 'released', expires_at = NOW()
   WHERE id = p_reservation_id
     AND workspace_id = p_workspace_id
     AND owner_user_id = p_owner_user_id
     AND status = 'reserved';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_draft_usage_status(
  p_workspace_id UUID,
  p_owner_user_id UUID,
  p_period_start DATE,
  p_metric TEXT DEFAULT 'draft_items_created'
)
RETURNS TABLE(used_count INTEGER, reserved_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
BEGIN
  SELECT owner_user_id INTO v_owner
    FROM public.workspaces
   WHERE id = p_workspace_id;
  IF NOT FOUND OR v_owner IS DISTINCT FROM p_owner_user_id THEN
    RAISE EXCEPTION 'Workspace owner verification failed';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE((
      SELECT count FROM public.usage_counters
       WHERE workspace_id = p_workspace_id
         AND metric = p_metric
         AND period_start = p_period_start
    ), 0)::INTEGER,
    (
      SELECT COUNT(*)::INTEGER FROM public.draft_usage_reservations
       WHERE workspace_id = p_workspace_id
         AND period_start = p_period_start
         AND metric = p_metric
         AND status = 'reserved'
         AND expires_at > NOW()
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_draft_usage_slot(UUID, UUID, DATE, DATE, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_draft_with_usage(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, public.post_status)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_draft_usage_slot(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_draft_usage_status(UUID, UUID, DATE, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_draft_usage_slot(UUID, UUID, DATE, DATE, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_draft_with_usage(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, public.post_status) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_draft_usage_slot(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_draft_usage_status(UUID, UUID, DATE, TEXT) TO service_role;

-- Keep the existing durable agent-job reservation mechanism aligned with the
-- same verified quota-period metric used by synchronous and MCP generation.
DROP FUNCTION IF EXISTS public.reserve_draft_usage(UUID, UUID, DATE, DATE, INTEGER);

CREATE OR REPLACE FUNCTION public.reserve_draft_usage(
  p_job_id UUID,
  p_workspace_id UUID,
  p_period_start DATE,
  p_period_end DATE,
  p_limit INTEGER DEFAULT 30,
  p_metric TEXT DEFAULT 'draft_items_created'
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
  v_reserved_metric TEXT;
  v_active_api_reservations INTEGER := 0;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_metric IS NULL
     OR p_metric NOT LIKE 'draft_items_created%' THEN
    RAISE EXCEPTION 'Invalid draft usage reservation arguments';
  END IF;

  SELECT workspace_id, payload INTO v_job_workspace, v_payload
    FROM public.agent_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job_workspace <> p_workspace_id THEN
    RAISE EXCEPTION 'agent job does not belong to the requested workspace';
  END IF;

  -- Serialize background reservations with API reservations and commits.
  PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace does not exist';
  END IF;

  IF v_payload ? 'draft_usage_reserved_period' THEN
    v_reserved_period := (v_payload->>'draft_usage_reserved_period')::DATE;
    v_reserved_metric := COALESCE(v_payload->>'draft_usage_reserved_metric', 'draft_items_created');
    IF v_reserved_period = p_period_start AND v_reserved_metric = p_metric THEN
      RETURN TRUE;
    END IF;
    UPDATE public.usage_counters
       SET count = GREATEST(count - 1, 0), updated_at = NOW()
     WHERE workspace_id = p_workspace_id
       AND metric = v_reserved_metric
       AND period_start = v_reserved_period;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_active_api_reservations
    FROM public.draft_usage_reservations
   WHERE workspace_id = p_workspace_id
     AND period_start = p_period_start
     AND metric = p_metric
     AND status = 'reserved'
     AND expires_at > NOW();

  IF v_active_api_reservations >= p_limit THEN
    UPDATE public.agent_jobs
       SET payload = payload - 'draft_usage_reserved_period' - 'draft_usage_reserved_metric',
           updated_at = NOW()
     WHERE id = p_job_id;
    RETURN FALSE;
  END IF;

  INSERT INTO public.usage_counters (workspace_id, metric, period_start, period_end, count)
  VALUES (p_workspace_id, p_metric, p_period_start, p_period_end, 1)
  ON CONFLICT (workspace_id, metric, period_start)
  DO UPDATE SET
    count = public.usage_counters.count + 1,
    period_end = EXCLUDED.period_end,
    updated_at = NOW()
  WHERE public.usage_counters.count + v_active_api_reservations < p_limit
  RETURNING count INTO v_count;

  IF v_count IS NULL THEN
    UPDATE public.agent_jobs
       SET payload = payload - 'draft_usage_reserved_period' - 'draft_usage_reserved_metric',
           updated_at = NOW()
     WHERE id = p_job_id;
    RETURN FALSE;
  END IF;

  UPDATE public.agent_jobs
     SET payload = jsonb_set(
       jsonb_set(payload, '{draft_usage_reserved_period}', to_jsonb(p_period_start::TEXT), TRUE),
       '{draft_usage_reserved_metric}', to_jsonb(p_metric), TRUE
     ),
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
  v_job_type TEXT;
  v_payload JSONB;
  v_period_start DATE;
  v_metric TEXT;
  v_cycle_date TEXT;
BEGIN
  SELECT workspace_id, job_type, payload INTO v_workspace_id, v_job_type, v_payload
    FROM public.agent_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR NOT (v_payload ? 'draft_usage_reserved_period') THEN
    RETURN;
  END IF;

  v_cycle_date := v_payload->>'cycleDate';
  IF v_cycle_date IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.content_posts
     WHERE workspace_id = v_workspace_id
       AND agent_cycle_key = v_workspace_id::TEXT || ':' || v_cycle_date
  ) THEN
    UPDATE public.agent_jobs
       SET payload = payload - 'draft_usage_reserved_period' - 'draft_usage_reserved_metric',
           updated_at = NOW()
     WHERE id = p_job_id;
    RETURN;
  END IF;

  IF v_job_type = 'telegram_content_generation' AND EXISTS (
    SELECT 1 FROM public.content_posts
     WHERE workspace_id = v_workspace_id
       AND telegram_job_id = p_job_id
  ) THEN
    UPDATE public.agent_jobs
       SET payload = payload - 'draft_usage_reserved_period' - 'draft_usage_reserved_metric',
           updated_at = NOW()
     WHERE id = p_job_id;
    RETURN;
  END IF;

  v_period_start := (v_payload->>'draft_usage_reserved_period')::DATE;
  v_metric := COALESCE(v_payload->>'draft_usage_reserved_metric', 'draft_items_created');
  UPDATE public.usage_counters
     SET count = GREATEST(count - 1, 0), updated_at = NOW()
   WHERE workspace_id = v_workspace_id
     AND metric = v_metric
     AND period_start = v_period_start;

  UPDATE public.agent_jobs
     SET payload = payload - 'draft_usage_reserved_period' - 'draft_usage_reserved_metric',
         updated_at = NOW()
   WHERE id = p_job_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reserve_draft_usage(UUID, UUID, DATE, DATE, INTEGER, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_draft_usage(UUID, UUID, DATE, DATE, INTEGER, TEXT)
  TO service_role;
