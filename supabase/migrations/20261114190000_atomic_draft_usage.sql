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

  SELECT COALESCE(count, 0) INTO v_used
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
