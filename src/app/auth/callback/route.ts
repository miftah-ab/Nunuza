import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /auth/callback
 *
 * Handles the OAuth code exchange after Google redirects back.
 * Phase 2: Real implementation using Supabase PKCE code exchange.
 *
 * Flow:
 * 1. Exchange `code` param for session (Supabase handles PKCE internally)
 * 2. Session is written to cookies by the server client
 * 3. The handle_new_user() DB trigger (migration 0003) creates profile + workspace
 * 4. Redirect to /app/overview (or the saved redirect param)
 *
 * Error cases:
 * - Provider returns error param → redirect to login with error message
 * - Missing code → redirect to login with error message
 * - Supabase exchange fails → redirect to login with safe error message
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  const redirectTo = searchParams.get("redirect") ?? "/app/overview";

  // Provider returned an error (e.g. user cancelled OAuth)
  if (error) {
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set(
      "error",
      errorDescription ?? error === "access_denied"
        ? "Sign-in was cancelled."
        : "Sign-in failed. Please try again."
    );
    return NextResponse.redirect(loginUrl.toString(), { status: 303 });
  }

  if (!code) {
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("error", "Invalid sign-in link. Please try again.");
    return NextResponse.redirect(loginUrl.toString(), { status: 303 });
  }

  const supabase = await createClient();

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("error", "Sign-in failed. Please try again.");
    // Log sanitized error server-side (not sent to client)
    console.error("[auth/callback] Code exchange error:", exchangeError.message);
    return NextResponse.redirect(loginUrl.toString(), { status: 303 });
  }

  // Validate redirect destination (prevent open redirect)
  const safeRedirect =
    redirectTo.startsWith("/") && !redirectTo.startsWith("//")
      ? redirectTo
      : "/app/overview";

  return NextResponse.redirect(new URL(safeRedirect, origin).toString(), { status: 303 });
}
