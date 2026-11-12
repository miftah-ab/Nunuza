import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  // A browser form must originate from this exact app origin.
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "We couldn’t verify this connection request. Please return to Claude and try again." }, { status: 403 });
  }

  const form = await request.formData();
  const authorizationId = form.get("authorization_id");
  const decision = form.get("decision");

  if (
    typeof authorizationId !== "string" ||
    authorizationId.length < 1 ||
    authorizationId.length > 200 ||
    (decision !== "approve" && decision !== "deny")
  ) {
    return NextResponse.json({ error: "Choose whether to allow or deny this connection." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    if (userError) console.error("[oauth] Could not verify signed-in user:", userError);
    const returnTo = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
    return NextResponse.redirect(new URL(`/login?redirect=${encodeURIComponent(returnTo)}`, request.url), { status: 303 });
  }

  // Do not issue new OAuth grants while the MCP feature is disabled.
  const effectiveDecision = process.env.MCP_ENABLED === "true" ? decision : "deny";
  const result =
    effectiveDecision === "approve"
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });

  if (result.error || !result.data?.redirect_url) {
    if (result.error) console.error("[oauth] Connection approval failed:", result.error);
    return NextResponse.json(
      { error: "We couldn’t complete this connection. Return to Claude and try again." },
      { status: 400 }
    );
  }

  let redirectUrl: URL;
  try {
    redirectUrl = new URL(result.data.redirect_url);
  } catch (error) {
    console.error("[oauth] Could not validate return address:", error);
    return NextResponse.json({ error: "We couldn’t complete this connection. Return to Claude and try again." }, { status: 400 });
  }

  if (redirectUrl.protocol !== "https:" && redirectUrl.hostname !== "localhost" && redirectUrl.hostname !== "127.0.0.1") {
    console.warn("[oauth] Rejected an unsafe connection return address.");
    return NextResponse.json({ error: "We couldn’t complete this connection. Return to Claude and try again." }, { status: 400 });
  }

  return NextResponse.redirect(redirectUrl, { status: 303 });
}
