/**
 * Next.js proxy — session refresh and route protection.
 *
 * Runs on every request matched by the `config.matcher` below.
 * Responsibilities:
 *   1. Refresh the Supabase session cookie if the token is expiring
 *   2. Redirect unauthenticated users away from /app/* routes to /login
 *   3. Redirect authenticated users away from /login to /app/overview
 *
 * IMPORTANT: This proxy does NOT enforce entitlement checks.
 * Entitlement is verified server-side in each route/page handler.
 * Client-side hiding is not authorization (spec §6 / BED-04).
 *
 * In local dev without real Supabase credentials the proxy passes all
 * requests through without session checks so the UI can be previewed.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Detect placeholder / missing Supabase configuration so local dev
// without a real project never crashes the proxy.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const SUPABASE_CONFIGURED =
  SUPABASE_URL.startsWith("https://") &&
  !SUPABASE_URL.includes("placeholder") &&
  SUPABASE_KEY.length > 20 &&
  !SUPABASE_KEY.includes("placeholder");

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ─── Skip Supabase when not configured (local dev / CI) ────────────────────
  if (!SUPABASE_CONFIGURED) {
    // Still protect /app/* — redirect to login
    if (pathname.startsWith("/app")) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next({ request });
  }

  // ─── Real Supabase session refresh ─────────────────────────────────────────
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: Parameters<typeof supabaseResponse.cookies.set>[2] }>) {
        // Forward cookies to both the request and the response
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // IMPORTANT: Do not add code between createServerClient and getUser().
  // A simple mistake can make the session not refresh properly.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ─── Protect /app/* routes ─────────────────────────────────────────────────
  if (pathname.startsWith("/app") && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set(
      "redirect",
      pathname // preserve intended destination
    );
    return NextResponse.redirect(loginUrl);
  }

  // ─── Redirect authenticated users away from /login ─────────────────────────
  if (pathname === "/login" && user) {
    const overviewUrl = request.nextUrl.clone();
    overviewUrl.pathname = "/app/overview";
    overviewUrl.searchParams.delete("redirect");
    return NextResponse.redirect(overviewUrl);
  }

  // ─── Return the response with refreshed session cookies ────────────────────
  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image (Next.js image optimization)
     * - favicon.ico, brand assets, fonts
     * - API routes that handle their own auth (webhooks, auth callbacks)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|brand/|fonts/|auth/callback|api/webhooks).*)",
  ],
};
