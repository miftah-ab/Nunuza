import { NextResponse } from "next/server";

export async function GET() {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  if (!publicKey) return NextResponse.json({ error: "Notifications are being configured." }, { status: 503 });
  return NextResponse.json({ publicKey }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
