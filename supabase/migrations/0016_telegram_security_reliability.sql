-- Telegram control-plane security and delivery reliability.
-- Webhook updates contain only Telegram's numeric update_id; message bodies are
-- deliberately not persisted. Service-role only access is enforced below.

CREATE TABLE public.telegram_webhook_updates (
  update_id BIGINT PRIMARY KEY CHECK (update_id >= 0),
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  locked_until TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_telegram_webhook_updates_retention
  ON public.telegram_webhook_updates (completed_at)
  WHERE status = 'completed';

ALTER TABLE public.telegram_webhook_updates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_webhook_updates FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.telegram_webhook_updates TO service_role;

CREATE OR REPLACE FUNCTION public.claim_telegram_webhook_update(p_update_id BIGINT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_row public.telegram_webhook_updates%ROWTYPE;
BEGIN
  IF p_update_id IS NULL OR p_update_id < 0 THEN
    RAISE EXCEPTION 'invalid_telegram_update_id';
  END IF;

  INSERT INTO public.telegram_webhook_updates (update_id, status, attempts, locked_until)
  VALUES (p_update_id, 'processing', 1, NOW() + INTERVAL '2 minutes')
  ON CONFLICT (update_id) DO NOTHING;

  IF FOUND THEN
    IF MOD(p_update_id, 1000) = 0 THEN
      DELETE FROM public.telegram_webhook_updates
      WHERE status = 'completed' AND completed_at < NOW() - INTERVAL '30 days';
    END IF;
    RETURN 'claimed';
  END IF;

  SELECT * INTO current_row
  FROM public.telegram_webhook_updates
  WHERE update_id = p_update_id
  FOR UPDATE;

  IF current_row.status = 'completed' THEN
    RETURN 'completed';
  END IF;

  IF current_row.status = 'processing' AND current_row.locked_until > NOW() THEN
    RETURN 'processing';
  END IF;

  UPDATE public.telegram_webhook_updates
  SET status = 'processing',
      attempts = attempts + 1,
      locked_until = NOW() + INTERVAL '2 minutes',
      updated_at = NOW()
  WHERE update_id = p_update_id;

  RETURN 'claimed';
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_telegram_webhook_update(p_update_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.telegram_webhook_updates
  SET status = 'completed',
      locked_until = NULL,
      completed_at = NOW(),
      updated_at = NOW()
  WHERE update_id = p_update_id AND status = 'processing';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'telegram_update_not_claimed';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_telegram_webhook_update(p_update_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.telegram_webhook_updates
  SET status = 'failed',
      locked_until = NULL,
      updated_at = NOW()
  WHERE update_id = p_update_id AND status = 'processing';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'telegram_update_not_claimed';
  END IF;
END;
$$;

-- Consume a pairing token, revoke replaced links, and create the new link in a
-- single transaction. Concurrent use of the same token serializes on FOR UPDATE.
CREATE OR REPLACE FUNCTION public.link_telegram_account(
  p_token_hash TEXT,
  p_telegram_user_id BIGINT,
  p_chat_id BIGINT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  token_row public.link_tokens%ROWTYPE;
  new_link_workspace_id UUID;
BEGIN
  IF p_token_hash IS NULL OR p_telegram_user_id IS NULL OR p_chat_id IS NULL THEN
    RAISE EXCEPTION 'invalid_pairing_request';
  END IF;

  SELECT * INTO token_row
  FROM public.link_tokens
  WHERE token_hash = p_token_hash
    AND consumed_at IS NULL
    AND expires_at > NOW()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.link_tokens
  SET consumed_at = NOW()
  WHERE id = token_row.id AND consumed_at IS NULL;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.telegram_links
  SET revoked_at = NOW()
  WHERE revoked_at IS NULL
    AND (workspace_id = token_row.workspace_id OR telegram_user_id = p_telegram_user_id);

  INSERT INTO public.telegram_links (
    workspace_id, telegram_user_id, chat_id, linked_at
  )
  VALUES (
    token_row.workspace_id, p_telegram_user_id, p_chat_id, NOW()
  );

  INSERT INTO public.audit_events (
    workspace_id, actor_type, actor_id, action, resource_type, safe_metadata
  )
  VALUES (
    token_row.workspace_id, 'user', token_row.user_id, 'telegram_linked',
    'telegram_link', '{"source":"telegram_pairing"}'::JSONB
  );

  new_link_workspace_id := token_row.workspace_id;
  RETURN new_link_workspace_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_telegram_webhook_update(BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_telegram_webhook_update(BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_telegram_webhook_update(BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.link_telegram_account(TEXT, BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_telegram_webhook_update(BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_telegram_webhook_update(BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_telegram_webhook_update(BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.link_telegram_account(TEXT, BIGINT, BIGINT) TO service_role;
