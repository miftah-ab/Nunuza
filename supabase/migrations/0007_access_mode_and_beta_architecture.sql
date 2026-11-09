-- Migration: 0007_access_mode_and_beta_architecture.sql
-- Applies after: 0006_lock_down_privileges.sql
--
-- Access and Entitlement Architecture Migration:
-- 1. Separates access mode (how access was granted) from commercial entitlement
-- 2. Introduces access_mode enum ('private_beta', 'commercial')
-- 3. Extends entitlement_type enum with 'internal_beta', 'suspended', 'expired'
-- 4. Adds beta tracking columns to workspaces table
-- 5. Implements admin_grant_private_beta and admin_revoke_private_beta functions
-- 6. Locks down all privileged beta and entitlement columns against client roles

-- ─── 1. Create access_mode enum ──────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'access_mode') THEN
    CREATE TYPE access_mode AS ENUM ('private_beta', 'commercial');
  END IF;
END$$;

-- ─── 2. Extend entitlement_type enum ─────────────────────────────────────────
-- Adds internal_beta, suspended, and expired to the existing entitlement_type enum.
ALTER TYPE entitlement_type ADD VALUE IF NOT EXISTS 'internal_beta';
ALTER TYPE entitlement_type ADD VALUE IF NOT EXISTS 'suspended';
ALTER TYPE entitlement_type ADD VALUE IF NOT EXISTS 'expired';

-- ─── 3. Add access_mode and beta tracking columns to workspaces ───────────────
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS access_mode access_mode NOT NULL DEFAULT 'commercial',
  ADD COLUMN IF NOT EXISTS beta_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS beta_notes TEXT,
  ADD COLUMN IF NOT EXISTS beta_granted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS beta_revoked_at TIMESTAMPTZ;

-- ─── 4. Admin RPC: Grant Private Beta ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_grant_private_beta(
  p_workspace_id UUID,
  p_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.workspaces
  SET
    access_mode = 'private_beta',
    entitlement_type = 'internal_beta',
    beta_expires_at = p_expires_at,
    beta_notes = p_notes,
    beta_granted_at = NOW(),
    beta_revoked_at = NULL,
    updated_at = NOW()
  WHERE id = p_workspace_id;

  INSERT INTO public.audit_events (
    workspace_id, actor_type, action, resource_type, resource_id, safe_metadata
  ) VALUES (
    p_workspace_id,
    'admin',
    'beta_access_granted',
    'workspace',
    p_workspace_id,
    jsonb_build_object(
      'new_entitlement', 'internal_beta',
      'access_mode', 'private_beta',
      'expires_at', p_expires_at,
      'notes', p_notes
    )
  );
END;
$$;

-- ─── 5. Admin RPC: Revoke Private Beta ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_revoke_private_beta(
  p_workspace_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.workspaces
  SET
    entitlement_type = 'suspended',
    state = 'paused',
    paused_at = COALESCE(paused_at, NOW()),
    beta_revoked_at = NOW(),
    beta_notes = COALESCE(p_notes, beta_notes),
    updated_at = NOW()
  WHERE id = p_workspace_id;

  -- Safely cancel any pending publish jobs for this workspace
  UPDATE public.agent_jobs
  SET
    status = 'canceled',
    updated_at = NOW()
  WHERE workspace_id = p_workspace_id
    AND status IN ('queued', 'waiting_for_approval');

  INSERT INTO public.audit_events (
    workspace_id, actor_type, action, resource_type, resource_id, safe_metadata
  ) VALUES (
    p_workspace_id,
    'admin',
    'beta_access_revoked',
    'workspace',
    p_workspace_id,
    jsonb_build_object(
      'new_entitlement', 'suspended',
      'reason', COALESCE(p_notes, 'Revoked by administrator')
    )
  );
END;
$$;

-- ─── 6. Restrict execute on admin beta functions to service_role ─────────────
REVOKE EXECUTE ON FUNCTION public.admin_grant_private_beta(UUID, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_revoke_private_beta(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_grant_private_beta(UUID, TIMESTAMPTZ, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_revoke_private_beta(UUID, TEXT) TO service_role;

-- ─── 7. Guard new privileged columns against client roles ─────────────────────
CREATE OR REPLACE FUNCTION public.guard_workspace_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF NEW.entitlement_type IS DISTINCT FROM OLD.entitlement_type
       OR NEW.access_mode IS DISTINCT FROM OLD.access_mode
       OR NEW.beta_expires_at IS DISTINCT FROM OLD.beta_expires_at
       OR NEW.beta_notes IS DISTINCT FROM OLD.beta_notes
       OR NEW.beta_granted_at IS DISTINCT FROM OLD.beta_granted_at
       OR NEW.beta_revoked_at IS DISTINCT FROM OLD.beta_revoked_at
       OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
       OR NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION
        'workspaces privileged columns (entitlement_type, access_mode, beta fields, owner_user_id, id) cannot be changed by client roles'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

