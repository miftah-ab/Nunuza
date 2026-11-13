import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { decryptSubscriptionValue } from "@/lib/notifications/subscription-crypto";
import { sendWebPush } from "@/lib/notifications/web-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const body = await request.json().catch(() => null) as { notificationId?: unknown } | null;
    if (typeof body?.notificationId !== "string" || !UUID_PATTERN.test(body.notificationId)) {
      return NextResponse.json({ error: "Please retry the notification test." }, { status: 400 });
    }

    const db = createServiceClient();
    const { data: subscription, error } = await db
      .from("web_push_subscriptions")
      .select("id,endpoint_encrypted,p256dh_encrypted,auth_secret_encrypted")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!subscription) {
      return NextResponse.json({
        error: "This browser isn’t connected yet. Enable notifications first, then run the test again.",
      }, { status: 409 });
    }

    const decrypted = {
      endpoint: await decryptSubscriptionValue(subscription.endpoint_encrypted),
      p256dh: await decryptSubscriptionValue(subscription.p256dh_encrypted),
      auth_secret: await decryptSubscriptionValue(subscription.auth_secret_encrypted),
    };
    const result = await sendWebPush(decrypted, {
      title: "Nunuza test notification",
      body: "Your browser notification connection is working.",
      url: "/app/notifications",
      notificationId: body.notificationId,
      tag: "nunuza-push-test",
    });

    if (result.expired) {
      await db.from("web_push_subscriptions").delete()
        .eq("id", subscription.id).eq("workspace_id", workspace.id);
      return NextResponse.json({
        error: "This browser connection has expired. Re-enable notifications and try again.",
      }, { status: 409 });
    }

    if (!result.ok) {
      console.error("[notifications] Test push provider rejected delivery:", result.status ?? "unknown");
      return NextResponse.json({
        error: "The notification service rejected this test. Please reconnect notifications and try again.",
      }, { status: 502 });
    }

    await db.from("web_push_subscriptions")
      .update({ last_success_at: new Date().toISOString() })
      .eq("id", subscription.id).eq("workspace_id", workspace.id);

    return NextResponse.json({ ok: true, notificationId: body.notificationId, providerAccepted: true });
  } catch (error) {
    console.error("[notifications] Test push failed:", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({
      error: "We couldn’t send a test notification right now. Please try again.",
    }, { status: 500 });
  }
}
