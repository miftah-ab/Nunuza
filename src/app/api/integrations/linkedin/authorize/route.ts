/**
 * GET /api/integrations/linkedin/authorize — initiates LinkedIn OAuth handshake
 */

import { NextResponse } from "next/server";
import crypto from "crypto";
import { cookies } from "next/headers";
import { requireWorkspace } from "@/lib/auth/workspace";
import { apiError } from "@/lib/api/respond";
import { getLinkedInAuthorizationUrl } from "@/lib/integrations/linkedin/client";

export async function GET() {
  try {
    await requireWorkspace();

    const state = crypto.randomBytes(24).toString("hex");
    const cookieStore = await cookies();

    // Store state in a short-lived secure cookie
    cookieStore.set("linkedin_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600, // 10 minutes
      path: "/",
    });

    const authUrl = getLinkedInAuthorizationUrl(state);
    return NextResponse.redirect(authUrl);
  } catch (err) {
    return apiError(err);
  }
}
