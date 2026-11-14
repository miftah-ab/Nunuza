-- Durable, idempotent hourly image-generation reservations. Rejected requests
-- do not increment usage, and a failed generation can release exactly its own
-- reservation without decrementing another request's counter.
CREATE TABLE IF NOT EXISTS public.image_generation_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  period_start DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'committed', 'released')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_image_generation_reservations_active
  ON public.image_generation_reservations(workspace_id, metric, period_start, expires_at)
  WHERE status = 'reserved';

ALTER TABLE public.image_generation_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.image_generation_reservations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.image_generation_reservations TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_image_generation(
  p_workspace_id UUID,
  p_metric TEXT,
  p_period_start DATE,
  p_period_end DATE,
  p_limit INTEGER
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation_id UUID;
  v_new_count INTEGER;
BEGIN
  IF p_workspace_id IS NULL OR p_metric IS NULL OR p_metric = ''
     OR p_period_start IS NULL OR p_period_end IS NULL
     OR p_period_end < p_period_start OR p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'Invalid image quota reservation arguments';
  END IF;

  -- Serialize cleanup and reservations for a workspace. This also ensures
  -- multiple image-generation requests cannot race past the hourly limit.
  PERFORM 1 FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace not found';
  END IF;

  WITH expired AS (
    UPDATE public.image_generation_reservations
       SET status = 'released', updated_at = NOW()
     WHERE workspace_id = p_workspace_id
       AND status = 'reserved'
       AND expires_at <= NOW()
     RETURNING metric, period_start
  ),
  expired_counts AS (
    SELECT metric, period_start, COUNT(*)::INTEGER AS reservation_count
      FROM expired
     GROUP BY metric, period_start
  )
  UPDATE public.usage_counters AS counters
     SET count = GREATEST(counters.count - expired_counts.reservation_count, 0),
         updated_at = NOW()
    FROM expired_counts
   WHERE counters.workspace_id = p_workspace_id
     AND counters.metric = expired_counts.metric
     AND counters.period_start = expired_counts.period_start;

  DELETE FROM public.image_generation_reservations
   WHERE workspace_id = p_workspace_id
     AND status IN ('committed', 'released')
     AND created_at < NOW() - INTERVAL '90 days';

  INSERT INTO public.usage_counters (
    workspace_id, metric, period_start, period_end, count
  ) VALUES (
    p_workspace_id, p_metric, p_period_start, p_period_end, 1
  )
  ON CONFLICT (workspace_id, metric, period_start)
  DO UPDATE SET
    count = public.usage_counters.count + 1,
    period_end = EXCLUDED.period_end,
    updated_at = NOW()
  WHERE public.usage_counters.count < p_limit
  RETURNING count INTO v_new_count;

  IF v_new_count IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.image_generation_reservations (
    workspace_id, metric, period_start, status, expires_at
  ) VALUES (
    p_workspace_id, p_metric, p_period_start, 'reserved', NOW() + INTERVAL '15 minutes'
  )
  RETURNING id INTO v_reservation_id;

  RETURN v_reservation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_image_generation_reservation(
  p_reservation_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE public.image_generation_reservations
     SET status = 'committed', expires_at = NULL, updated_at = NOW()
   WHERE id = p_reservation_id
     AND status = 'reserved';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_image_generation_reservation(
  p_reservation_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id UUID;
  v_metric TEXT;
  v_period_start DATE;
  v_updated INTEGER;
BEGIN
  UPDATE public.image_generation_reservations
     SET status = 'released', expires_at = NULL, updated_at = NOW()
   WHERE id = p_reservation_id
     AND status IN ('reserved', 'committed')
  RETURNING workspace_id, metric, period_start
       INTO v_workspace_id, v_metric, v_period_start;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN FALSE;
  END IF;

  UPDATE public.usage_counters
     SET count = GREATEST(count - 1, 0), updated_at = NOW()
   WHERE workspace_id = v_workspace_id
     AND metric = v_metric
     AND period_start = v_period_start;

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_image_generation(UUID, TEXT, DATE, DATE, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.commit_image_generation_reservation(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_image_generation_reservation(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_image_generation(UUID, TEXT, DATE, DATE, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_image_generation_reservation(UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_image_generation_reservation(UUID)
  TO service_role;
