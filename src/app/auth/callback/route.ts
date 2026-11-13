import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const EARLY_ACCESS_MESSAGE =
  "Nunuza is currently available to approved users only. Join the waitlist to request access.";

function isEarlyAccessRejection(message: string, errorCode?: string | null): boolean {
  const code = (errorCode ?? "").toLowerCase();
  if (["signup_disabled", "hook_rejected", "hook_timeout"].includes(code)) return true;

  const normalized = message.toLowerCase();
  return [
    "private testing period",
    "request early access",
    "database error saving new user",
    "signup is disabled",
    "signups are disabled",
    "signups not allowed",
    "not allowed to sign up",
    "before-user-created",
    "before user created",
    "new user creation",
  ].some((pattern) => normalized.includes(pattern));
}

function loginRedirect(origin: string, error: string) {
  const url = new URL("/login", origin);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url.toString(), { status: 303 });
}

/**
 * GET /auth/callback
 *
 * Exchanges Supabase's PKCE code and routes provider/hook errors to safe,
 * user-facing messages. A rejected new-user signup is not a failed sign-in.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const errorCode = searchParams.get("error_code");
  const errorDescription = searchParams.get("error_description") ?? "";
  const redirectTo = searchParams.get("redirect") ?? "/app/overview";

  if (error) {
    if (isEarlyAccessRejection(errorDescription, errorCode)) {
      return loginRedirect(origin, "early_access_required");
    }
    return loginRedirect(origin, error === "access_denied" ? "sign_in_cancelled" : "sign_in_failed");
  }

  if (!code) return loginRedirect(origin, "invalid_sign_in_link");

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    const blocked = isEarlyAccessRejection(exchangeError.message, exchangeError.code);
    if (blocked) return loginRedirect(origin, "early_access_required");

    console.error("[auth/callback] Code exchange error:", exchangeError.message);
    return loginRedirect(origin, "sign_in_failed");
  }

  const safeRedirect =
    redirectTo.startsWith("/") && !redirectTo.startsWith("//")
      ? redirectTo
      : "/app/overview";

  return NextResponse.redirect(new URL(safeRedirect, origin).toString(), { status: 303 });
}
