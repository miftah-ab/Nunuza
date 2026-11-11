-- Retired publishing_beta workspaces become internal_beta in 0011.
-- Keep the separate access-mode dimension consistent with that private entitlement.
UPDATE public.workspaces
   SET access_mode = 'private_beta'::public.access_mode,
       updated_at = NOW()
 WHERE entitlement_type = 'internal_beta'::public.entitlement_type
   AND access_mode IS DISTINCT FROM 'private_beta'::public.access_mode;
