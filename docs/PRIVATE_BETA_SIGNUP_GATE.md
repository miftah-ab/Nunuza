# Private beta signup gate

Nunuza uses Supabase Auth's **Before User Created** HTTP hook to close public registration without blocking existing users.

## Vercel environment variables

Set these for the Production environment:

- `PUBLIC_SIGNUP_ENABLED=false` during the private test. Only the exact value `true` opens registration.
- `SUPABASE_AUTH_HOOK_SECRET` to a long random secret (at least 32 random bytes).

Do not prefix either variable with `NEXT_PUBLIC_`. Redeploy after changing environment variables.

## Configure Supabase Auth once

In the Supabase project dashboard:

1. Open **Authentication → Hooks**.
2. Add/enable **Before User Created** and choose the HTTP hook option.
3. Set the endpoint URL to `https://nunuza.vercel.app/api/auth/before-user-created` (use the production hostname).
4. Add an `Authorization` request header with value `Bearer <the exact SUPABASE_AUTH_HOOK_SECRET value>`.
5. Save the hook and test it before sharing the public login URL.

The hook is the enforcement point: Supabase calls it immediately before inserting a new Auth user. Existing users signing in do not invoke it. If the flag is anything other than the literal string `true`, new account creation is rejected.

## Opening registration

After the private test, change `PUBLIC_SIGNUP_ENABLED` to `true` in Vercel's Production environment and redeploy. No database migration or code change is needed to open registration.

## Operational checks

- Keep the hook configured after launch; it becomes an allow-through check while the flag is `true`.
- Never expose the hook secret in client-side code, public environment variables, logs, or Git.
- If the hook secret is missing or invalid, the hook fails closed and new registrations will fail. Existing sign-ins remain unaffected.
- The `/early-access` intake is separate from Auth and continues to collect requests during the private test.
