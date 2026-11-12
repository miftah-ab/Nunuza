-- Supabase migration: mcp_oauth_security
-- Secure Supabase OAuth-issued MCP tokens from direct Data API access.
-- Browser sessions retain their normal audience and tenant RLS behavior.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

-- Supabase Auth invokes this hook before issuing or refreshing access tokens.
-- OAuth Server client tokens are identified by claims.client_id.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $function$
DECLARE
  claims jsonb := event -> 'claims';
BEGIN
  IF claims IS NULL OR jsonb_typeof(claims) <> 'object' THEN
    RETURN jsonb_build_object(
      'error',
      jsonb_build_object(
        'http_code', 500,
        'message', 'Invalid access-token hook payload.'
      )
    );
  END IF;

  IF claims ? 'client_id' THEN
    claims := jsonb_set(
      claims,
      '{aud}',
      to_jsonb('https://nunuza-xi.vercel.app/api/mcp'::text),
      true
    );
  END IF;

  RETURN jsonb_build_object('claims', claims);
END;
$function$;

REVOKE ALL ON FUNCTION public.custom_access_token_hook(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb)
  TO supabase_auth_admin;

-- This helper is needed by existing tenant RLS policies. Keep it in a schema
-- that is not exposed by the Supabase Data API, and return NULL for OAuth clients.
CREATE OR REPLACE FUNCTION private.current_workspace_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN (auth.jwt() ->> 'client_id') IS NOT NULL THEN NULL::uuid
    ELSE (
      SELECT id
      FROM public.workspaces
      WHERE owner_user_id = auth.uid()
      LIMIT 1
    )
  END;
$function$;

REVOKE ALL ON FUNCTION private.current_workspace_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_workspace_id() TO authenticated;

-- Move all existing tenant policies away from the exposed SECURITY DEFINER RPC.
DO $migration$
DECLARE
  policy_row record;
  updated_using text;
  updated_check text;
BEGIN
  FOR policy_row IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        COALESCE(qual, '') ILIKE '%current_workspace_id()%'
        OR COALESCE(with_check, '') ILIKE '%current_workspace_id()%'
      )
  LOOP
    updated_using := CASE
      WHEN policy_row.qual IS NULL THEN NULL
      ELSE replace(policy_row.qual, 'current_workspace_id()', 'private.current_workspace_id()')
    END;
    updated_check := CASE
      WHEN policy_row.with_check IS NULL THEN NULL
      ELSE replace(policy_row.with_check, 'current_workspace_id()', 'private.current_workspace_id()')
    END;

    EXECUTE format(
      'ALTER POLICY %I ON %I.%I%s%s',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename,
      CASE WHEN updated_using IS NULL THEN '' ELSE format(' USING (%s)', updated_using) END,
      CASE WHEN updated_check IS NULL THEN '' ELSE format(' WITH CHECK (%s)', updated_check) END
    );
  END LOOP;
END;
$migration$;

-- The old helper is no longer used by policies and must not be callable as RPC.
REVOKE ALL ON FUNCTION public.current_workspace_id()
  FROM PUBLIC, anon, authenticated;

-- OAuth tokens keep the authenticated database role, so block them explicitly
-- at the RLS layer across every currently RLS-protected public table.
DO $migration$
DECLARE
  target_table record;
  policy_name constant text := 'deny_oauth_client_direct_data_api';
BEGIN
  FOR target_table IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND rowsecurity = true
    ORDER BY tablename
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      policy_name,
      'public',
      target_table.tablename
    );

    EXECUTE format(
      'CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((auth.jwt() ->> ''client_id'') IS NULL) WITH CHECK ((auth.jwt() ->> ''client_id'') IS NULL)',
      policy_name,
      'public',
      target_table.tablename
    );
  END LOOP;
END;
$migration$;

-- Trigger functions are not public RPC endpoints.
REVOKE ALL ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated;

-- Remove the remaining mutable-search-path warning from the timestamp trigger.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;
