/**
 * GET /app/integrations/linkedin/callback — handles LinkedIn OAuth callback
 */

import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { requireWorkspace } from "@/lib/auth/workspace";
import {
  exchangeLinkedInCode,
  saveLinkedInConnection,
} from "@/lib/integrations/linkedin/client";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  if (errorParam) {
    const redirectUrl = new URL("/app/integrations", baseUrl);
    redirectUrl.searchParams.set("error", errorDescription ?? errorParam);
    return NextResponse.redirect(redirectUrl);
  }

  if (!code || !state) {
    const redirectUrl = new URL("/app/integrations", baseUrl);
    redirectUrl.searchParams.set("error", "Missing OAuth authorization code or state.");
    return NextResponse.redirect(redirectUrl);
  }

  const cookieStore = await cookies();
  const savedState = cookieStore.get("linkedin_oauth_state")?.value;

  if (!savedState || savedState !== state) {
    const redirectUrl = new URL("/app/integrations", baseUrl);
    redirectUrl.searchParams.set("error", "Invalid or expired OAuth state parameter (CSRF detected).");
    return NextResponse.redirect(redirectUrl);
  }

  // Clear state cookie
  cookieStore.delete("linkedin_oauth_state");

  try {
    const workspace = await requireWorkspace();
    const tokenData = await exchangeLinkedInCode(code);

    await saveLinkedInConnection(workspace.id, workspace.owner_user_id, tokenData);

    const redirectUrl = new URL("/app/integrations", baseUrl);
    redirectUrl.searchParams.set("connected", "linkedin");
    return NextResponse.redirect(redirectUrl);
  } catch (err: unknown) {
    const redirectUrl = new URL("/app/integrations", baseUrl);
    redirectUrl.searchParams.set(
      "error",
      err instanceof Error ? err.message : "Failed to complete LinkedIn connection."
    );
    return NextResponse.redirect(redirectUrl);
  }
}
