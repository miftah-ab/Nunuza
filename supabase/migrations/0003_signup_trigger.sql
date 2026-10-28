-- Migration: 0003_signup_trigger.sql
-- Applies after: 0002_rls_policies.sql
--
-- Creates a DB trigger that fires when a new user signs up via Supabase Auth.
-- On INSERT into auth.users, automatically:
--   1. Creates a row in public.profiles
--   2. Creates a workspace with entitlement_type = 'draft_only' (always, regardless of client input)
--
-- This is the ONLY code path that creates workspaces for public signups.
-- entitlement_type is hardcoded to 'draft_only' here; it can only be
-- elevated by a service-role admin function (see 0004_admin_functions.sql).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER        -- runs as the function owner, not the calling role
SET search_path = public
AS $$
DECLARE
  v_display_name TEXT;
BEGIN
  -- Extract display name from Google OAuth metadata
  v_display_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );

  -- 1. Create profile
  INSERT INTO public.profiles (id, display_name, avatar_url, timezone)
  VALUES (
    NEW.id,
    v_display_name,
    NEW.raw_user_meta_data->>'avatar_url',
    'UTC'   -- user sets their timezone during onboarding
  )
  ON CONFLICT (id) DO NOTHING;  -- idempotent; handles duplicate triggers

  -- 2. Create workspace with draft_only entitlement — always, regardless of any client input
  -- Public signup NEVER receives publishing_beta, internal_test, or paid entitlements.
  INSERT INTO public.workspaces (
    owner_user_id,
    name,
    state,
    entitlement_type,
    operating_mode
  )
  VALUES (
    NEW.id,
    COALESCE(v_display_name || '''s Workspace', 'My Workspace'),
    'setup_required',
    'draft_only',         -- hardcoded; only admin functions can change this
    'approval_required'   -- always starts in approval required mode
  )
  ON CONFLICT (owner_user_id) DO NOTHING;  -- idempotent; v1 one workspace per user

  RETURN NEW;
END;
$$;

-- Attach trigger to auth.users
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

COMMENT ON FUNCTION public.handle_new_user() IS
  'Fires on new Supabase Auth signup. Creates profile + workspace with draft_only entitlement.
   entitlement_type is hardcoded to draft_only; it cannot be elevated through this path.
   To provision internal_test or publishing_beta, use the admin functions in 0004_admin_functions.sql.';
