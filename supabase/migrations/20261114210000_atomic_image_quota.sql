-- Reserve hourly image quota atomically. A rejected request does not
-- increment usage, and failed generation can release its reservation.
CREATE OR REPLACE FUNCTION public.reserve_usage_counter(
  p_workspace_id UUID,
  p_metric TEXT,
  p_period_start DATE,
  p_period_end DATE,
  p_limit INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  IF p_workspace_id IS NULL OR p_metric IS NULL OR p_metric = ''
     OR p_period_start IS NULL OR p_period_end IS NULL
     OR p_period_end < p_period_start OR p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'Invalid usage reservation arguments';
  END IF;

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

  -- NULL means the limit was already reached; no counter mutation occurred.
  RETURN v_new_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_usage_counter(
  p_workspace_id UUID,
  p_metric TEXT,
  p_period_start DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.usage_counters
     SET count = GREATEST(count - 1, 0),
         updated_at = NOW()
   WHERE workspace_id = p_workspace_id
     AND metric = p_metric
     AND period_start = p_period_start
  RETURNING count INTO v_count;

  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_usage_counter(UUID, TEXT, DATE, DATE, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_usage_counter(UUID, TEXT, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_usage_counter(UUID, TEXT, DATE, DATE, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_usage_counter(UUID, TEXT, DATE)
  TO service_role;
