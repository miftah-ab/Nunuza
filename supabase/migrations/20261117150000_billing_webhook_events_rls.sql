-- billing_webhook_events is written only by the server (service role and the
-- SECURITY DEFINER claim_billing_webhook_event function). It was created
-- without RLS, and Supabase grants new public tables to the anon and
-- authenticated roles by default, so anyone holding the public anon key could
-- read, insert, edit or delete rows through the REST API. Webhook idempotency
-- keys live here, so that must not be possible.
--
-- With RLS enabled and no policies, those roles get no access. The service
-- role bypasses RLS and SECURITY DEFINER functions run as the table owner, so
-- the Polar webhook path is unaffected.

ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.billing_webhook_events FROM anon, authenticated;
