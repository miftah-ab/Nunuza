-- Migration: 0006_lock_down_privileges.sql
-- Applies after: 0005_usage_counter_rpc.sql
--
-- Security fix. Two privilege-escalation paths existed through the Supabase
-- API (PostgREST), which is reachable by any signed-in user with the public
-- key that ships in the browser:
--
--   1. SECURITY DEFINER functions created in the public schema (0004, 0005)
--      had no REVOKE, so any signed-in user could call them via /rpc and
--      change their own workspaces.entitlement_type (e.g. to paid_active or
--      publishing_beta) or inflate/reset usage counters.
--
--   2. workspaces_owner_update (0002) allows UPDATE of every column on the
--      owner's own row. Its comment says entitlement_type is "enforced in
--      application code", which does not stop a direct API call.
--
-- This migration only restricts access to objects that already exist. It does
-- not add tables or columns, and it does not change what the application
-- (which uses the service-role client for these functions) already does.

-- ─── 1. Restrict SECURITY DEFINER functions to the service role ──────────────
-- Callers in src/: only incrementDraftCounter() uses increment_usage_counter,
-- and it uses createServiceClient(). The admin_* functions and
-- apply_polar_subscription_state have no application callers; they are run
-- by an administrator (service role / SQL editor) per BED-03.

REVOKE EXECUTE ON FUNCTION public.admin_provision_internal_test(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_revoke_internal_test(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_provision_publishing_beta(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_polar_subscription_state(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_usage_counter(UUID, TEXT, DATE, DATE)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_provision_internal_test(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_revoke_internal_test(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_provision_publishing_beta(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_polar_subscription_state(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_usage_counter(UUID, TEXT, DATE, DATE) TO service_role;

-- current_workspace_id() is intentionally NOT revoked: the RLS policies in
-- 0002 call it as the signed-in user, and tenant-isolation.test.ts exercises
-- it. It is SECURITY DEFINER without a fixed search_path, so pin one.
ALTER FUNCTION public.current_workspace_id() SET search_path = public;

-- ─── 2. Guard privileged workspace columns against client roles ──────────────
-- Client roles (anon / authenticated, i.e. requests made with a user JWT) may
-- still update the columns the app writes through the user-scoped client
-- (name, operating_mode, paused_at, state), but never entitlement_type,
-- owner_user_id or id. The service role and the SECURITY DEFINER functions
-- above run as a different current_user and are not affected.
-- Deliberately not SECURITY DEFINER, so current_user is the real caller.

CREATE OR REPLACE FUNCTION public.guard_workspace_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF NEW.entitlement_type IS DISTINCT FROM OLD.entitlement_type
       OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
       OR NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION
        'workspaces.entitlement_type, owner_user_id and id cannot be changed by client roles'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workspaces_guard_privileged ON public.workspaces;
CREATE TRIGGER trg_workspaces_guard_privileged
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.guard_workspace_privileged_columns();

-- ─── 3. Guard publish-result fields on content_posts against client roles ───
-- Only the worker (service role) may record that a post is publishing or
-- published, or set published_at / linkedin_post_id. Nothing in src/ writes
-- these through a user-scoped client. Without this, a client could mark its
-- own post "published" with a made-up LinkedIn URN.

CREATE OR REPLACE FUNCTION public.guard_post_publish_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.status IN ('publishing', 'published')
         OR NEW.published_at IS NOT NULL
         OR NEW.linkedin_post_id IS NOT NULL THEN
        RAISE EXCEPTION
          'content_posts publish-result fields cannot be set by client roles'
          USING ERRCODE = '42501';
      END IF;
    ELSE
      IF (NEW.status IS DISTINCT FROM OLD.status
            AND NEW.status IN ('publishing', 'published'))
         OR NEW.published_at IS DISTINCT FROM OLD.published_at
         OR NEW.linkedin_post_id IS DISTINCT FROM OLD.linkedin_post_id THEN
        RAISE EXCEPTION
          'content_posts publish-result fields cannot be set by client roles'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_content_posts_guard_publish ON public.content_posts;
CREATE TRIGGER trg_content_posts_guard_publish
  BEFORE INSERT OR UPDATE ON public.content_posts
  FOR EACH ROW EXECUTE FUNCTION public.guard_post_publish_columns();
