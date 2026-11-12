-- Durable notification inbox and device push subscriptions.
-- Critical notifications are created automatically from authoritative state transitions.

CREATE TABLE public.notification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('publishing','approval','agent','integration','billing','system')),
  priority TEXT NOT NULL CHECK (priority IN ('normal','high','critical')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  href TEXT NOT NULL DEFAULT '/app/notifications',
  read_at TIMESTAMPTZ,
  push_status TEXT NOT NULL DEFAULT 'pending' CHECK (push_status IN ('pending','sent','failed','skipped')),
  telegram_status TEXT NOT NULL DEFAULT 'pending' CHECK (telegram_status IN ('pending','sent','failed','skipped')),
  push_attempts INTEGER NOT NULL DEFAULT 0,
  telegram_attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_delivery_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, event_key)
);
CREATE INDEX notification_events_workspace_time ON public.notification_events(workspace_id, created_at DESC);
CREATE INDEX notification_events_delivery ON public.notification_events(next_attempt_at)
  WHERE push_status = 'pending' OR telegram_status = 'pending';

CREATE TABLE public.web_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth_secret TEXT NOT NULL,
  expiration_time BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_success_at TIMESTAMPTZ
);
CREATE INDEX web_push_subscriptions_workspace ON public.web_push_subscriptions(workspace_id);

ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_events, public.web_push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.notification_events, public.web_push_subscriptions TO service_role;

-- Only authenticated workspace owners can read/update their inbox through RLS.
GRANT SELECT, UPDATE ON public.notification_events TO authenticated;
CREATE POLICY notification_events_owner_read ON public.notification_events
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY notification_events_owner_update ON public.notification_events
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.create_notification_event(
  p_workspace_id UUID,
  p_event_key TEXT,
  p_category TEXT,
  p_priority TEXT,
  p_title TEXT,
  p_body TEXT,
  p_href TEXT DEFAULT '/app/notifications'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user_id UUID; v_id UUID;
BEGIN
  SELECT owner_user_id INTO v_user_id FROM public.workspaces WHERE id = p_workspace_id;
  IF v_user_id IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.notification_events
    (workspace_id,user_id,event_key,category,priority,title,body,href)
  VALUES
    (p_workspace_id,v_user_id,p_event_key,p_category,p_priority,
     left(p_title,120),left(p_body,500),
     CASE WHEN p_href LIKE '/app/%' AND p_href NOT LIKE '//%' THEN p_href ELSE '/app/notifications' END)
  ON CONFLICT (workspace_id,event_key) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_notification_event(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_notification_event(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.notify_post_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_category TEXT; v_priority TEXT; v_title TEXT; v_body TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status = 'published' THEN
    v_category := 'publishing'; v_priority := 'high'; v_title := 'Your post was published'; v_body := 'Your LinkedIn post was successfully published.';
  ELSIF NEW.status = 'failed' THEN
    v_category := 'publishing'; v_priority := 'critical'; v_title := 'Your post needs attention'; v_body := 'Publishing failed. Review the post and try again.';
  ELSIF NEW.status = 'needs_reconciliation' THEN
    v_category := 'publishing'; v_priority := 'critical'; v_title := 'Publishing status needs checking'; v_body := 'We could not confirm the final publishing result. Review this post before retrying.';
  ELSIF NEW.status = 'needs_review' THEN
    v_category := 'approval'; v_priority := 'high'; v_title := 'A post is ready for your approval'; v_body := 'A new post is waiting for your review.';
  ELSE RETURN NEW;
  END IF;
  PERFORM public.create_notification_event(
    NEW.workspace_id, 'post:' || NEW.id::text || ':status:' || NEW.status::text,
    v_category,v_priority,v_title,v_body,'/app/content?post=' || NEW.id::text
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_notify_post_status
AFTER UPDATE OF status ON public.content_posts
FOR EACH ROW EXECUTE FUNCTION public.notify_post_status_change();

CREATE OR REPLACE FUNCTION public.notify_agent_job_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_title TEXT; v_body TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status = 'failed_terminal' THEN
    v_title := 'An agent task failed'; v_body := COALESCE(NEW.safe_error_message,'A background task could not be completed. Open Nunuza to review it.');
  ELSIF NEW.status = 'needs_reconciliation' THEN
    v_title := 'An agent task needs your attention'; v_body := COALESCE(NEW.safe_error_message,'Nunuza needs you to review an unresolved task.');
  ELSIF NEW.status = 'waiting_for_approval' THEN
    v_title := 'Your approval is needed'; v_body := 'An agent task is waiting for your approval.';
  ELSE RETURN NEW;
  END IF;
  PERFORM public.create_notification_event(
    NEW.workspace_id,'job:' || NEW.id::text || ':status:' || NEW.status::text,
    CASE WHEN NEW.status = 'waiting_for_approval' THEN 'approval' ELSE 'agent' END,
    CASE WHEN NEW.status = 'waiting_for_approval' THEN 'high' ELSE 'critical' END,
    v_title,left(v_body,500),'/app/activity'
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_notify_agent_job_status
AFTER UPDATE OF status ON public.agent_jobs
FOR EACH ROW EXECUTE FUNCTION public.notify_agent_job_status_change();

CREATE OR REPLACE FUNCTION public.notify_approval_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.action IN ('approved','rejected','revised') THEN
    PERFORM public.create_notification_event(
      NEW.workspace_id,'approval:' || NEW.id::text,'approval','normal',
      CASE NEW.action WHEN 'approved' THEN 'Post approved' WHEN 'rejected' THEN 'Post rejected' ELSE 'Post needs revision' END,
      CASE NEW.action WHEN 'approved' THEN 'Your post was approved.' WHEN 'rejected' THEN 'Your post was rejected.' ELSE 'A post was sent back for revision.' END,
      '/app/content?post=' || NEW.post_id::text
    );
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_notify_approval_event
AFTER INSERT ON public.approval_events
FOR EACH ROW EXECUTE FUNCTION public.notify_approval_event();

CREATE OR REPLACE FUNCTION public.notify_integration_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'expired' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.create_notification_event(
      NEW.workspace_id,'integration:' || NEW.provider::text || ':expired:' || COALESCE(NEW.updated_at::text,''),
      'integration','critical',
      CASE WHEN NEW.provider = 'linkedin' THEN 'Reconnect LinkedIn' ELSE 'Reconnect an integration' END,
      'Your connection has expired. Reconnect it to keep Nunuza working.',
      '/app/integrations'
    );
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_notify_integration_status
AFTER UPDATE OF status ON public.integration_connections
FOR EACH ROW EXECUTE FUNCTION public.notify_integration_status_change();

CREATE OR REPLACE FUNCTION public.claim_pending_notification_deliveries(p_limit INTEGER DEFAULT 50)
RETURNS SETOF public.notification_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT id FROM public.notification_events
    WHERE next_attempt_at <= NOW()
      AND (push_status = 'pending' OR telegram_status = 'pending')
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit,1),100)
  )
  UPDATE public.notification_events n
  SET next_attempt_at = NOW() + INTERVAL '2 minutes'
  FROM candidates c WHERE n.id = c.id
  RETURNING n.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_pending_notification_deliveries(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_notification_deliveries(INTEGER) TO service_role;
