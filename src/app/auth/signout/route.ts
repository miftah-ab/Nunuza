import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /auth/signout
 *
 * Signs out the current user, clears the session cookie,
 * and redirects to the public homepage.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const origin = new URL(request.url).origin;

  await supabase.auth.signOut();

  return NextResponse.redirect(`${origin}/`, { status: 303 });
}
