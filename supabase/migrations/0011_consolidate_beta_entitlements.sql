-- Consolidate retired beta entitlements into internal_beta and remove legacy enum values.
-- Existing workspace access is preserved; this migration does not revoke anyone's access.
UPDATE public.workspaces
SET entitlement_type = 'internal_beta'
WHERE entitlement_type::text IN ('publishing_beta', 'internal_test');

UPDATE public.subscriptions
SET entitlement_snapshot = 'internal_beta'
WHERE entitlement_snapshot::text IN ('publishing_beta', 'internal_test');

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
