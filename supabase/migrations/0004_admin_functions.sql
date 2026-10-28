-- Migration: 0004_admin_functions.sql
-- Applies after: 0003_signup_trigger.sql
--
-- Admin-only service-role functions for entitlement provisioning.
-- These functions are SECURITY DEFINER and must ONLY be called from
-- authenticated server-side code with a verified service-role key.
-- They are NOT exposed through any RLS-accessible API.

-- ─── Provision internal_test entitlement ─────────────────────────────────────
-- Can only be called by service-role (admin).
-- Preconditions (enforced by calling code, not DB):
--   - LinkedIn product/scope approval is evidenced
--   - Automated duplicate/idempotency tests have passed
--   - Workspace is a designated internal test workspace (not a customer workspace)
CREATE OR REPLACE FUNCTION public.admin_provision_internal_test(p_workspace_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.workspaces
  SET
    entitlement_type = 'internal_test',
    updated_at = NOW()
  WHERE id = p_workspace_id;

  -- Audit the entitlement change
  INSERT INTO public.audit_events (
    workspace_id, actor_type, action, resource_type, resource_id, safe_metadata
  ) VALUES (
    p_workspace_id,
    'admin',
    'entitlement_changed',
    'workspace',
    p_workspace_id,
    jsonb_build_object('new_entitlement', 'internal_test', 'previous_entitlement',
      (SELECT entitlement_type FROM public.workspaces WHERE id = p_workspace_id))
  );
END;
$$;

-- ─── Revoke internal_test → draft_only after acceptance test ─────────────────
-- Must be called immediately after the internal acceptance-test publish succeeds.
-- internal_test is automatically reverted; it does NOT grant publishing_beta.
CREATE OR REPLACE FUNCTION public.admin_revoke_internal_test(p_workspace_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.workspaces
  SET
    entitlement_type = 'draft_only',
    updated_at = NOW()
  WHERE id = p_workspace_id
    AND entitlement_type = 'internal_test';  -- only reverts internal_test; no-op otherwise

  INSERT INTO public.audit_events (
    workspace_id, actor_type, action, resource_type, resource_id, safe_metadata
  ) VALUES (
    p_workspace_id,
    'admin',
    'entitlement_changed',
    'workspace',
    p_workspace_id,
    jsonb_build_object('new_entitlement', 'draft_only', 'reason', 'internal_test_revoked_after_acceptance')
  );
END;
$$;

-- ─── Provision publishing_beta entitlement ────────────────────────────────────
-- Only for explicitly selected test-cohort workspaces.
-- Preconditions enforced by calling code:
--   - Internal acceptance-test publish passed
--   - LinkedIn API access verified
--   - Duplicate/reconciliation acceptance passed
CREATE OR REPLACE FUNCTION public.admin_provision_publishing_beta(p_workspace_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.workspaces
  SET
    entitlement_type = 'publishing_beta',
    updated_at = NOW()
  WHERE id = p_workspace_id;

  INSERT INTO public.audit_events (
    workspace_id, actor_type, action, resource_type, resource_id, safe_metadata
  ) VALUES (
    p_workspace_id,
    'admin',
    'entitlement_changed',
    'workspace',
    p_workspace_id,
    jsonb_build_object('new_entitlement', 'publishing_beta')
  );
END;
$$;

-- ─── Apply Polar subscription state ──────────────────────────────────────────
-- Called only from the Polar webhook handler (server-side, service-role).
-- Maps Polar subscription status to workspace entitlement_type.
CREATE OR REPLACE FUNCTION public.apply_polar_subscription_state(
  p_workspace_id UUID,
  p_polar_status TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_entitlement entitlement_type;
BEGIN
  -- Map Polar status to entitlement — must match Polar's documented status values
  v_new_entitlement := CASE p_polar_status
    WHEN 'trialing' THEN 'paid_trial'::entitlement_type
    WHEN 'active'   THEN 'paid_active'::entitlement_type
    WHEN 'canceled' THEN 'inactive'::entitlement_type
    WHEN 'past_due' THEN 'inactive'::entitlement_type
    WHEN 'unpaid'   THEN 'inactive'::entitlement_type
    WHEN 'revoked'  THEN 'inactive'::entitlement_type
    ELSE 'inactive'::entitlement_type
  END;

  UPDATE public.workspaces
  SET
    entitlement_type = v_new_entitlement,
    updated_at = NOW()
  WHERE id = p_workspace_id;

  INSERT INTO public.audit_events (
    workspace_id, actor_type, action, resource_type, resource_id, safe_metadata
  ) VALUES (
    p_workspace_id,
    'system',
    'entitlement_changed',
    'workspace',
    p_workspace_id,
    jsonb_build_object(
      'new_entitlement', v_new_entitlement::text,
      'polar_status', p_polar_status
    )
  );
END;
$$;

COMMENT ON FUNCTION public.admin_provision_internal_test(UUID) IS
  'Admin-only. Provision internal_test entitlement for acceptance testing.
   Must be revoked via admin_revoke_internal_test after acceptance.';

COMMENT ON FUNCTION public.admin_provision_publishing_beta(UUID) IS
  'Admin-only. Provision publishing_beta for explicitly selected test-cohort workspaces.
   Requires internal test pass, LinkedIn access, and duplicate/reconciliation acceptance.';

COMMENT ON FUNCTION public.apply_polar_subscription_state(UUID, TEXT) IS
  'Called from Polar webhook handler (service-role only). Maps Polar status to entitlement.';
