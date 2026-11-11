-- Give Supabase OAuth-issued MCP access tokens a resource-specific audience.
-- Normal Nunuza browser sessions retain the default "authenticated" audience.
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

  -- Supabase OAuth Server places the registered OAuth client ID in this claim.
  -- It remains present on refreshed OAuth tokens, unlike authentication_method.
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

-- Auth must be the only role allowed to invoke the token hook.
REVOKE ALL ON FUNCTION public.custom_access_token_hook(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb)
  TO supabase_auth_admin;

-- A client_id claim identifies a Supabase OAuth Server-issued client token.
-- Such tokens may call only the Nunuza MCP server, never Supabase Data API tables.
-- Restrictive policies compose with existing owner/tenant policies and preserve
-- ordinary browser sessions. service_role continues to bypass RLS as intended.
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

-- current_workspace_id() is intentionally used by existing RLS policies.
-- Return NULL for OAuth clients so direct RPC calls cannot reveal workspace IDs
-- and existing tenant policies also fail closed for OAuth tokens.
CREATE OR REPLACE FUNCTION public.current_workspace_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
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

-- Trigger-only function: it must not be callable as a client RPC.
REVOKE EXECUTE ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated;
