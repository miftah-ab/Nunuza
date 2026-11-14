-- Track when a subscription was last verified directly with Polar and
-- serialize webhook event claims so concurrent deliveries cannot process the
-- same lifecycle event twice.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS provider_verified_at TIMESTAMPTZ;

ALTER TABLE public.billing_webhook_events
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.claim_billing_webhook_event(
  p_provider_event_id TEXT,
  p_event_type TEXT
)
RETURNS TABLE(claimed BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status public.webhook_processing_status;
  v_started_at TIMESTAMPTZ;
  v_inserted INTEGER;
BEGIN
  IF p_provider_event_id IS NULL OR p_provider_event_id = ''
     OR p_event_type IS NULL OR p_event_type = '' THEN
    RAISE EXCEPTION 'provider event id and type are required';
  END IF;

  INSERT INTO public.billing_webhook_events (
    provider_event_id, type, received_at, processing_status,
    processing_started_at, attempt_count
  ) VALUES (
    p_provider_event_id, p_event_type, NOW(), 'pending', NOW(), 1
  )
  ON CONFLICT (provider_event_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 1 THEN
    RETURN QUERY SELECT TRUE, 'CLAIMED'::TEXT;
    RETURN;
  END IF;

  SELECT processing_status, processing_started_at
    INTO v_status, v_started_at
    FROM public.billing_webhook_events
   WHERE provider_event_id = p_provider_event_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'EVENT_NOT_FOUND'::TEXT;
    RETURN;
  END IF;

  IF v_status IN ('processed', 'duplicate') THEN
    RETURN QUERY SELECT FALSE, 'ALREADY_PROCESSED'::TEXT;
    RETURN;
  END IF;

  IF v_status = 'pending' AND v_started_at IS NOT NULL
     AND v_started_at > NOW() - INTERVAL '5 minutes' THEN
    RETURN QUERY SELECT FALSE, 'IN_PROGRESS'::TEXT;
    RETURN;
  END IF;

  UPDATE public.billing_webhook_events
     SET type = p_event_type,
         received_at = NOW(),
         processed_at = NULL,
         processing_status = 'pending',
         processing_started_at = NOW(),
         attempt_count = attempt_count + 1,
         safe_error_code = NULL
   WHERE provider_event_id = p_provider_event_id;

  RETURN QUERY SELECT TRUE, 'RECLAIMED'::TEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_billing_webhook_event(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_billing_webhook_event(TEXT, TEXT)
  TO service_role;
