import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_HOOK_AGE_SECONDS = 5 * 60;

function verifySupabaseWebhook(
  payload: string,
  headers: Headers,
  configuredSecret: string
): boolean {
  // Supabase signs HTTP Auth Hook requests using Standard Webhooks.
  // The dashboard-generated secret has the form: v1,whsec_<base64 secret>.
  const prefix = "v1,whsec_";
  if (!configuredSecret.startsWith(prefix)) return false;

  const secret = Buffer.from(configuredSecret.slice(prefix.length), "base64");
  if (secret.length < 32) return false;

  const webhookId = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature");

  if (!webhookId || !timestamp || !signatures) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds)) return false;

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds);
  if (ageSeconds > MAX_HOOK_AGE_SECONDS) return false;

  const signedContent = `${webhookId}.${timestamp}.${payload}`;
  const expected = createHmac("sha256", secret).update(signedContent).digest();

  // Standard Webhooks can include multiple versioned signatures during key rotation.
  return signatures.split(" ").some((entry) => {
    const [version, encodedSignature] = entry.split(",", 2);
    if (version !== "v1" || !encodedSignature) return false;

    let received: Buffer;
    try {
      received = Buffer.from(encodedSignature, "base64");
    } catch {
      return false;
    }

    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}

/**
 * Supabase Auth "Before User Created" HTTP hook.
 *
 * Supabase signs each request using Standard Webhooks. Generate the secret
 * in Supabase Dashboard → Authentication → Hooks and store the exact
 * v1,whsec_... value in Vercel as SUPABASE_AUTH_HOOK_SECRET.
 *
 * This hook runs only before a NEW auth user is created. Existing users can
 * continue signing in because their sign-in does not create a new auth user.
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

  const payload = await request.text();
  if (!verifySupabaseWebhook(payload, request.headers, secret)) {
    return NextResponse.json(
      { error: { http_code: 401, message: "Invalid hook signature." } },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  let event: unknown;
  try {
    event = JSON.parse(payload);
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
          message:
            "Nunuza is currently in a private testing period. Request early access to be notified when it opens.",
        },
      },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json({}, { status: 200, headers: { "Cache-Control": "no-store" } });
}
