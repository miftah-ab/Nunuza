-- Notify the owner when a post is scheduled or its scheduled time changes.
-- The durable dispatcher delivers high-priority events to push and Telegram.

CREATE OR REPLACE FUNCTION public.notify_post_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_category TEXT;
  v_priority TEXT;
  v_title TEXT;
  v_body TEXT;
  v_event_key TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status
      AND (NEW.status <> 'scheduled' OR NEW.scheduled_at IS NOT DISTINCT FROM OLD.scheduled_at) THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.status = 'published' THEN
    v_category := 'publishing';
    v_priority := 'high';
    v_title := 'Your post was published';
    v_body := 'Your LinkedIn post was successfully published.';
    v_event_key := 'post:' || NEW.id::text || ':status:published:' || COALESCE(NEW.updated_at::text,'');
  ELSIF NEW.status = 'failed' THEN
    v_category := 'publishing';
    v_priority := 'critical';
    v_title := 'Your post needs attention';
    v_body := 'Publishing failed. Review the post and try again.';
    v_event_key := 'post:' || NEW.id::text || ':status:failed:' || COALESCE(NEW.updated_at::text,'');
  ELSIF NEW.status = 'needs_reconciliation' THEN
    v_category := 'publishing';
    v_priority := 'critical';
    v_title := 'Publishing status needs checking';
    v_body := 'We could not confirm the final publishing result. Review this post before retrying.';
    v_event_key := 'post:' || NEW.id::text || ':status:needs_reconciliation:' || COALESCE(NEW.updated_at::text,'');
  ELSIF NEW.status = 'needs_review' THEN
    v_category := 'approval';
    v_priority := 'high';
    v_title := 'A post is ready for your approval';
    v_body := 'A new post is waiting for your review.';
    v_event_key := 'post:' || NEW.id::text || ':status:needs_review:' || COALESCE(NEW.updated_at::text,'');
  ELSIF NEW.status = 'scheduled' THEN
    v_category := 'publishing';
    v_priority := 'high';
    v_title := 'Your post is scheduled';
    v_body := CASE
      WHEN NEW.scheduled_at IS NULL THEN 'Your LinkedIn post has been scheduled.'
      ELSE 'Your LinkedIn post is scheduled for ' ||
        to_char(NEW.scheduled_at AT TIME ZONE 'UTC', 'Mon DD, YYYY at HH12:MI AM') || ' UTC.'
    END;
    v_event_key := 'post:' || NEW.id::text || ':scheduled:' || COALESCE(NEW.scheduled_at::text,'unspecified');
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.create_notification_event(
    NEW.workspace_id,
    v_event_key,
    v_category,
    v_priority,
    v_title,
    v_body,
    '/app/content?post=' || NEW.id::text
  );
  RETURN NEW;
END;
$$;
