/**
 * Supabase browser (client-side) client factory.
 *
 * Uses the publishable anon key only — never the service-role key.
 * Singleton pattern: creates one instance per browser session.
 * Used only in Client Components ("use client").
 */

"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

let _client: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function createClient() {
  if (_client) return _client;

  _client = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );

  return _client;
}
