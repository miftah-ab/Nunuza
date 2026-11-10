-- Extend an active worker lease without allowing a stale attempt to renew a newer claim.
CREATE OR REPLACE FUNCTION public.renew_agent_job_execution(
  p_job_id UUID,
  p_attempt_count INTEGER,
  p_expected_lease_until TIMESTAMPTZ,
  p_new_lease_until TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_job_id IS NULL
     OR p_attempt_count IS NULL
     OR p_attempt_count < 1
     OR p_expected_lease_until IS NULL
     OR p_new_lease_until IS NULL
     OR p_new_lease_until <= NOW()
     OR p_new_lease_until > NOW() + INTERVAL '1 hour' THEN
    RAISE EXCEPTION 'Invalid job lease renewal arguments';
  END IF;

  UPDATE public.agent_jobs
     SET lease_until = p_new_lease_until,
         updated_at = NOW()
   WHERE id = p_job_id
     AND status = 'running'
     AND attempt_count = p_attempt_count
     AND lease_until = p_expected_lease_until
     AND lease_until > NOW();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.renew_agent_job_execution(UUID, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_agent_job_execution(UUID, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ)
  TO service_role;
