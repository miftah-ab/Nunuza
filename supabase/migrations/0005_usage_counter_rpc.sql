-- Migration: 0005_usage_counter_rpc.sql
-- Applies after: 0004_admin_functions.sql
--
-- Atomic usage counter increment function.
-- Called by src/lib/db/usage.ts via supabase.rpc().
-- Uses ON CONFLICT DO UPDATE with count = count + 1 for atomicity.
-- Returns the new count after increment.

CREATE OR REPLACE FUNCTION public.increment_usage_counter(
  p_workspace_id UUID,
  p_metric       TEXT,
  p_period_start DATE,
  p_period_end   DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  INSERT INTO public.usage_counters (
    workspace_id, metric, period_start, period_end, count
  )
  VALUES (
    p_workspace_id, p_metric, p_period_start, p_period_end, 1
  )
  ON CONFLICT (workspace_id, metric, period_start)
  DO UPDATE SET
    count = public.usage_counters.count + 1,
    updated_at = NOW()
  RETURNING count INTO v_new_count;

  RETURN v_new_count;
END;
$$;

COMMENT ON FUNCTION public.increment_usage_counter(UUID, TEXT, DATE, DATE) IS
  'Atomically increments a usage counter, upserting the row if needed.
   Returns the new count. Called by the server-side usage module.
   SECURITY DEFINER so service-role clients can increment counters
   that are not directly client-writable.';
