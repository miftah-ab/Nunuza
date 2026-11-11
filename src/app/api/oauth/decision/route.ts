import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  // A browser form must originate from this exact app origin.
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
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
    return NextResponse.json({ error: "Invalid authorization decision." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    const returnTo = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
    return NextResponse.redirect(new URL(`/login?redirect=${encodeURIComponent(returnTo)}`, request.url), { status: 303 });
  }

  const result =
    decision === "approve"
      ? await supabase.auth.oauth.approveAuthorization(authorizationId)
      : await supabase.auth.oauth.denyAuthorization(authorizationId);

  if (result.error || !result.data?.redirect_url) {
    return NextResponse.json(
      { error: "We couldn't complete this authorization. Return to Claude and try again." },
      { status: 400 }
    );
  }

  const redirectUrl = new URL(result.data.redirect_url);
  if (redirectUrl.protocol !== "https:" && redirectUrl.hostname !== "localhost" && redirectUrl.hostname !== "127.0.0.1") {
    return NextResponse.json({ error: "The authorization provider returned an unsafe redirect." }, { status: 400 });
  }

  return NextResponse.redirect(redirectUrl, { status: 303 });
}
