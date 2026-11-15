-- A Telegram generation job can terminally fail long after the person has
-- already sent a newer topic and received a draft (e.g. a job that was stuck
-- before a worker fix). Telling them "No draft was saved" next to a fresh draft
-- is contradictory, so when a newer generation job succeeded we say plainly
-- that an EARLIER request did not finish and that the latest draft is fine.

CREATE OR REPLACE FUNCTION public.notify_agent_job_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_title TEXT;
  v_body TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'failed_terminal' THEN
    IF NEW.job_type = 'telegram_content_generation' THEN
      IF EXISTS (
        SELECT 1
          FROM public.content_posts p
         WHERE p.workspace_id = NEW.workspace_id
           AND p.telegram_job_id = NEW.id
           AND p.status IN ('draft', 'needs_review')
      ) THEN
        v_title := 'Your draft is saved';
        v_body := 'Your LinkedIn draft is saved, but I could not deliver its preview image to Telegram. Your work is safe. Nothing has been published.';
      ELSIF EXISTS (
        SELECT 1
          FROM public.agent_jobs newer
         WHERE newer.workspace_id = NEW.workspace_id
           AND newer.job_type = 'telegram_content_generation'
           AND newer.status = 'succeeded'
           AND newer.created_at > NEW.created_at
      ) THEN
        v_title := 'An earlier request did not finish';
        v_body := 'One of your earlier topics could not be turned into a draft. Your latest draft is ready. Send the earlier topic again if you still want it.';
      ELSE
        v_title := 'Your draft could not be created';
        v_body := 'Nunuza could not finish creating your LinkedIn draft after repeated interruptions. No draft was saved. Please send the topic again to retry.';
      END IF;
    ELSE
      v_title := 'An agent task failed';
      v_body := COALESCE(
        NULLIF(NEW.safe_error_message, ''),
        'A background task could not be completed. Open Nunuza to review it.'
      );
    END IF;
  ELSIF NEW.status = 'needs_reconciliation' THEN
    v_title := 'An agent task needs your attention';
    v_body := COALESCE(
      NULLIF(NEW.safe_error_message, ''),
      'Nunuza needs you to review an unresolved task.'
    );
  ELSIF NEW.status = 'waiting_for_approval' THEN
    v_title := 'Your approval is needed';
    v_body := 'An agent task is waiting for your approval.';
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.create_notification_event(
    NEW.workspace_id,
    'job:' || NEW.id::text || ':status:' || NEW.status::text,
    CASE
      WHEN NEW.status = 'waiting_for_approval' THEN 'approval'
      ELSE 'agent'
    END,
    CASE
      WHEN NEW.status = 'waiting_for_approval' THEN 'high'
      ELSE 'critical'
    END,
    v_title,
    left(v_body, 500),
    '/app/activity'
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_agent_job_status_change()
  FROM PUBLIC, anon, authenticated;
