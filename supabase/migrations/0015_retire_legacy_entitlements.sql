-- Retire the two legacy beta entitlements without rewriting historical migrations.
-- publishing_beta becomes internal_beta but is forced back to approval_required.
-- internal_test is downgraded to draft_only and paused; it is not promoted to beta.
-- The enum rebuild is conditional so this also works on databases where a prior
-- entitlement-consolidation migration has already removed the labels.

DO $$
DECLARE
  has_legacy_labels BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_enum e ON e.enumtypid = t.oid
     WHERE n.nspname = 'public'
       AND t.typname = 'entitlement_type'
       AND e.enumlabel IN ('publishing_beta', 'internal_test')
  ) INTO has_legacy_labels;

  IF NOT has_legacy_labels THEN
    RETURN;
  END IF;

  -- Preserve beta access for publishing_beta users, but disable unattended publishing.
  UPDATE public.workspaces
     SET operating_mode = 'approval_required',
         state = CASE
           WHEN state = 'active_autopilot' THEN 'active_approval_required'::public.agent_state
           ELSE state
         END
   WHERE entitlement_type::text = 'publishing_beta';

  -- internal_test was only a one-off acceptance entitlement; revoke publishing.
  UPDATE public.workspaces
     SET entitlement_type = 'draft_only',
         access_mode = 'commercial',
         operating_mode = 'approval_required',
         state = 'paused',
         paused_at = COALESCE(paused_at, NOW()),
         updated_at = NOW()
   WHERE entitlement_type::text = 'internal_test';

  UPDATE public.workspaces
     SET entitlement_type = 'internal_beta'
   WHERE entitlement_type::text = 'publishing_beta';

  UPDATE public.subscriptions
     SET entitlement_snapshot = CASE entitlement_snapshot::text
       WHEN 'publishing_beta' THEN 'internal_beta'
       WHEN 'internal_test' THEN 'draft_only'
       ELSE entitlement_snapshot::text
     END::public.entitlement_type
   WHERE entitlement_snapshot::text IN ('publishing_beta', 'internal_test');

  -- PostgreSQL cannot remove enum labels in place. Rebuild the type after all
  -- referencing rows have been mapped to the supported entitlement set.
  ALTER TABLE public.workspaces
    ALTER COLUMN entitlement_type DROP DEFAULT;

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
END;
$$;
