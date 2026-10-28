import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /auth/google
 *
 * Initiates Google OAuth flow via Supabase Auth.
 * Returns a redirect to the Google authorization page.
 * After Google auth, Google redirects to /auth/callback.
 *
 * Phase 2: This is the real implementation — replaces the 503 stub.
 * Requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 * to be configured in .env.local.
 *
 * If Supabase is not configured, Supabase's client will throw — this is
 * intentional fail-fast behavior (not a silent failure).
 */
export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const supabase = await createClient();

  // Read optional redirect param (set by middleware when protecting /app/* routes)
  const formData = await request.formData().catch(() => null);
  const redirectTo = formData?.get("redirect")?.toString();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback${redirectTo ? `?redirect=${encodeURIComponent(redirectTo)}` : ""}`,
      scopes: "openid email profile",
      queryParams: {
        // Force account selection so users can switch Google accounts
        prompt: "select_account",
      },
    },
  });

  if (error || !data.url) {
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("error", error?.message ?? "Failed to start sign-in.");
    return NextResponse.redirect(loginUrl.toString(), { status: 303 });
  }

  // Redirect to Google authorization page
  return NextResponse.redirect(data.url, { status: 303 });
}
