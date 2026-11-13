-- Explicitly deny Data API access to public roles.
-- The server-side service_role bypasses RLS and remains the only writer.
drop policy if exists early_access_signups_deny_public on public.early_access_signups;
create policy early_access_signups_deny_public
  on public.early_access_signups
  for all
  to anon, authenticated
  using (false)
  with check (false);

revoke all on table public.early_access_signups from anon, authenticated;
grant all on table public.early_access_signups to service_role;
