/**
 * Supabase server-side client factory.
 *
 * Creates a Supabase client that reads/writes session cookies using the
 * Next.js `cookies()` API — required for server components, Route Handlers,
 * and Server Actions.
 *
 * Uses the ANON key (not service-role). All database access goes through RLS.
 * For admin operations that must bypass RLS, use createServiceClient() below.
 *
 * Ref: @supabase/ssr docs — https://supabase.com/docs/guides/auth/server-side/nextjs
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";

/**
 * Anon client — server components, route handlers.
 * Reads and writes session cookies. Subject to RLS.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: Parameters<typeof cookieStore.set>[2] }>) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // setAll called from a Server Component — cookies are read-only there.
            // The middleware will handle cookie refresh for those cases.
          }
        },
      },
    }
  );
}

/**
 * Service-role client — bypasses RLS.
 * ONLY for server-side admin operations (webhook handlers, queue consumers,
 * admin provisioning). NEVER use in a client component or expose to the browser.
 *
 * The SUPABASE_SERVICE_ROLE_KEY is a server-only secret and must never
 * be included in any client bundle.
 */
export function createServiceClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "[supabase] SUPABASE_SERVICE_ROLE_KEY is not set. " +
        "This client must only be used server-side. " +
        "Check .env.local or Cloudflare secrets."
    );
  }

  // Import createClient dynamically or from @supabase/supabase-js
  const { createClient: _createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
  return _createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
