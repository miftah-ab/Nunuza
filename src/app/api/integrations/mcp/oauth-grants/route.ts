import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A valid JSON body is required." }, { status: 400 });
  }

  const clientId = (body as { clientId?: unknown } | null)?.clientId;
  if (typeof clientId !== "string" || clientId.length < 1 || clientId.length > 256) {
    return NextResponse.json({ error: "A valid OAuth client ID is required." }, { status: 400 });
  }

  const { data: grants, error: grantsError } = await supabase.auth.oauth.listGrants();
  if (grantsError) {
    return NextResponse.json({ error: "Unable to verify authorized clients." }, { status: 502 });
  }

  const ownsGrant = Array.isArray(grants)
    && grants.some((grant) => grant.client.id === clientId);

  if (!ownsGrant) {
    return NextResponse.json({ error: "This OAuth client is not authorized for your account." }, { status: 404 });
  }

  const { error: revokeError } = await supabase.auth.oauth.revokeGrant({ clientId });
  if (revokeError) {
    return NextResponse.json({ error: "Unable to revoke this OAuth connection." }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
