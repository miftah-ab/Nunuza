-- Trigger functions are not client RPCs. Remove PostgreSQL's default PUBLIC execute grant.
REVOKE EXECUTE ON FUNCTION public.release_agent_job_usage_on_terminal() FROM PUBLIC, anon, authenticated;
