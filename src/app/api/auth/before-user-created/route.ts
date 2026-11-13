import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Supabase Auth "Before User Created" HTTP hook.
 *
 * This hook is invoked only when Supabase is about to create a NEW auth user.
 * Existing users signing in with Google do not invoke it and remain able to log in.
 *
 * Configure the Supabase Auth hook URL as:
 *   https://<production-domain>/api/auth/before-user-created
 * Add an Authorization header in the Supabase hook configuration:
 *   Bearer <same value as SUPABASE_AUTH_HOOK_SECRET>
 */
export async function POST(request: Request) {
  const secret = process.env.SUPABASE_AUTH_HOOK_SECRET;
  if (!secret) {
    console.error("[auth/before-user-created] Hook secret is not configured.");
    return NextResponse.json(
      { error: { http_code: 503, message: "Signup verification is temporarily unavailable." } },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authorization);

  const authorized =
    received.length === expected.length &&
    timingSafeEqual(received, expected);

  if (!authorized) {
    return NextResponse.json(
      { error: { http_code: 401, message: "Unauthorized." } },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  let event: unknown;
  try {
    event = await request.json();
  } catch {
    return NextResponse.json(
      { error: { http_code: 400, message: "Invalid hook payload." } },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (
    !event ||
    typeof event !== "object" ||
    !("metadata" in event) ||
    !event.metadata ||
    typeof event.metadata !== "object" ||
    !("name" in event.metadata) ||
    event.metadata.name !== "before-user-created" ||
    !("user" in event) ||
    !event.user ||
    typeof event.user !== "object" ||
    !("id" in event.user)
  ) {
    return NextResponse.json(
      { error: { http_code: 400, message: "Invalid before-user-created event." } },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Fail closed: only the literal string "true" opens public registration.
  if (process.env.PUBLIC_SIGNUP_ENABLED !== "true") {
    return NextResponse.json(
      {
        error: {
          http_code: 403,
          message: "Nunuza is currently in a private testing period. Request early access to be notified when it opens.",
        },
      },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json({}, { status: 200, headers: { "Cache-Control": "no-store" } });
}
