import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "We couldn’t verify this request. Please return to the app and try again." }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    if (userError) console.error("[oauth-grants] Could not verify signed-in user:", userError);
    return NextResponse.json({ error: "Your session may have expired. Please sign in again." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "We couldn’t read that request. Please try again." }, { status: 400 });
  }

  const clientId = (body as { clientId?: unknown } | null)?.clientId;
  if (typeof clientId !== "string" || clientId.length < 1 || clientId.length > 256) {
    return NextResponse.json({ error: "We couldn’t identify this connected app. Please refresh and try again." }, { status: 400 });
  }

  const { data: grants, error: grantsError } = await supabase.auth.oauth.listGrants();
  if (grantsError) {
    console.error("[oauth-grants] Could not load connected apps:", grantsError);
    return NextResponse.json({ error: "We couldn’t load your connected apps. Please try again." }, { status: 502 });
  }

  const ownsGrant = Array.isArray(grants)
    && grants.some((grant) => grant.client.id === clientId);

  if (!ownsGrant) {
    return NextResponse.json({ error: "This app isn’t connected to your account." }, { status: 404 });
  }

  const { error: revokeError } = await supabase.auth.oauth.revokeGrant({ clientId });
  if (revokeError) {
    console.error("[oauth-grants] Could not disconnect connected app:", revokeError);
    return NextResponse.json({ error: "We couldn’t disconnect this app. Please try again." }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
