-- Migration: 0008_atomic_job_claim.sql
-- Applies after: 0007_access_mode_and_beta_architecture.sql
--
-- Atomic job claiming for the durable job runner.
--
-- Before this migration claimDueJobs() selected candidate rows and then updated
-- them by id only, so two workers could claim the same job. This function claims
-- jobs inside one statement using FOR UPDATE SKIP LOCKED, so concurrent workers
-- can never receive the same row, and attempt_count is incremented exactly once
-- per successful claim.
--
-- Eligibility (all must hold):
--   - status IN ('queued', 'failed_retryable')
--   - scheduled_for <= now()                      (respects scheduling and retry backoff)
--   - lease_until IS NULL OR lease_until <= now() (respects active leases)
--   - attempt_count < max_attempts                (max attempts handled below)
--
-- Jobs that are due but already out of attempts are moved to failed_terminal
-- in the same call so they never loop forever.

CREATE OR REPLACE FUNCTION public.claim_due_agent_jobs(
  p_limit          INTEGER,
  p_lease_seconds  INTEGER,
  p_job_types      TEXT[] DEFAULT NULL
)
RETURNS SETOF public.agent_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 100';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'p_lease_seconds must be between 30 and 3600';
  END IF;

  -- Exhausted jobs: terminalize instead of retrying forever.
  UPDATE public.agent_jobs
     SET status             = 'failed_terminal',
         finished_at        = NOW(),
         updated_at         = NOW(),
         last_error_code    = 'MAX_ATTEMPTS_EXCEEDED',
         safe_error_message = 'Max retry attempts exceeded.'
   WHERE status IN ('queued', 'failed_retryable')
     AND scheduled_for <= NOW()
     AND (lease_until IS NULL OR lease_until <= NOW())
     AND attempt_count >= max_attempts
     AND (p_job_types IS NULL OR job_type = ANY (p_job_types));

  RETURN QUERY
  WITH due AS (
    SELECT id
      FROM public.agent_jobs
     WHERE status IN ('queued', 'failed_retryable')
       AND scheduled_for <= NOW()
       AND (lease_until IS NULL OR lease_until <= NOW())
       AND attempt_count < max_attempts
       AND (p_job_types IS NULL OR job_type = ANY (p_job_types))
     ORDER BY scheduled_for ASC, created_at ASC
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.agent_jobs AS j
     SET status        = 'running',
         started_at    = NOW(),
         lease_until   = NOW() + make_interval(secs => p_lease_seconds),
         attempt_count = j.attempt_count + 1,
         updated_at    = NOW()
    FROM due
   WHERE j.id = due.id
  RETURNING j.*;
END;
$$;

-- Only the worker (service_role) may claim jobs. Never callable by client roles.
REVOKE EXECUTE ON FUNCTION public.claim_due_agent_jobs(INTEGER, INTEGER, TEXT[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_agent_jobs(INTEGER, INTEGER, TEXT[])
  TO service_role;

-- Supports the claim query above.
CREATE INDEX IF NOT EXISTS idx_agent_jobs_claim
  ON public.agent_jobs (scheduled_for)
  WHERE status IN ('queued', 'failed_retryable');
