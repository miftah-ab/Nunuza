-- Consolidate retired beta entitlements and remove legacy enum values.
-- publishing_beta allowed human-approved publishing but did not allow unattended
-- Autopilot. It maps to internal_beta only after Autopilot is explicitly disabled.
-- internal_test was a one-time acceptance-test entitlement; it must NOT be
-- upgraded to full beta access, so it is downgraded to draft_only.
UPDATE public.workspaces
SET operating_mode = 'approval_required',
    state = CASE
      WHEN state = 'active_autopilot' THEN 'active_approval_required'::public.agent_state
      ELSE state
    END
WHERE entitlement_type::text = 'publishing_beta';

-- The one-time internal_test entitlement is retired completely: remove its
-- beta access mode, disable unattended operation, and pause the workspace.
UPDATE public.workspaces
SET entitlement_type = 'draft_only',
    access_mode = 'commercial',
    operating_mode = 'approval_required',
    state = 'paused',
    paused_at = COALESCE(paused_at, NOW())
WHERE entitlement_type::text = 'internal_test';

UPDATE public.workspaces
SET entitlement_type = CASE entitlement_type::text
  WHEN 'publishing_beta' THEN 'internal_beta'
  WHEN 'internal_test' THEN 'draft_only'
  ELSE entitlement_type::text
END::public.entitlement_type;

UPDATE public.subscriptions
SET entitlement_snapshot = CASE entitlement_snapshot::text
  WHEN 'publishing_beta' THEN 'internal_beta'
  WHEN 'internal_test' THEN 'draft_only'
  ELSE entitlement_snapshot::text
END::public.entitlement_type;

-- Rebuild the enum because PostgreSQL cannot directly remove enum labels.
ALTER TABLE public.workspaces ALTER COLUMN entitlement_type DROP DEFAULT;
ALTER TYPE public.entitlement_type RENAME TO entitlement_type_legacy;

CREATE TYPE public.entitlement_type AS ENUM (
  'draft_only',
  'internal_beta',
  'paid_trial',
  'paid_active',
  'suspended',
  'expired',
  'inactive'
);

ALTER TABLE public.workspaces
  ALTER COLUMN entitlement_type TYPE public.entitlement_type
  USING entitlement_type::text::public.entitlement_type;

ALTER TABLE public.subscriptions
  ALTER COLUMN entitlement_snapshot TYPE public.entitlement_type
  USING entitlement_snapshot::text::public.entitlement_type;

ALTER TABLE public.workspaces
  ALTER COLUMN entitlement_type SET DEFAULT 'draft_only'::public.entitlement_type;

DROP TYPE public.entitlement_type_legacy;

COMMENT ON COLUMN public.workspaces.entitlement_type IS
  'Server-controlled entitlement. internal_beta is the sole private-beta entitlement; paid_trial/paid_active are set from verified Polar webhooks.';
