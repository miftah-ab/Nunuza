import { NextRequest, NextResponse } from "next/server";

export function GET(request: NextRequest) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin).replace(/\\/$/, "");
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\\/$/, "");

  if (!supabaseUrl.startsWith("https://")) {
    return NextResponse.json({ error: "OAuth authorization server is not configured." }, { status: 503 });
  }

  return NextResponse.json(
    {
      resource: `${appUrl}/api/mcp`,
      authorization_servers: [`${supabaseUrl}/auth/v1`],
      bearer_methods_supported: ["header"],
    },
    { headers: { "Cache-Control": "public, max-age=300" } }
  );
}
