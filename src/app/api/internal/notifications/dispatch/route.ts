import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { dispatchPendingNotifications } from "@/lib/notifications/dispatcher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function hasValidCronSecret(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!expected || expected.length < 32 || !authorization?.startsWith("Bearer ")) return false;

  const supplied = authorization.slice("Bearer ".length);
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length !== suppliedBytes.length) return false;
  return timingSafeEqual(expectedBytes, suppliedBytes);
}

export async function POST(request: Request) {
  if (!hasValidCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Keep each invocation short on Vercel Hobby. The minute scheduler will
    // pick up the next due batch; the database claim RPC prevents duplicates.
    const result = await dispatchPendingNotifications(2);
    return NextResponse.json({ ok: true, ...result });
  } catch {
    console.error("[notifications] Scheduled delivery pass failed.");
    return NextResponse.json(
      { ok: false, error: "Notification delivery is temporarily unavailable." },
      { status: 500 }
    );
  }
}
