import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { encryptSubscriptionValue, hashSubscriptionEndpoint } from "@/lib/notifications/subscription-crypto";

function validEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
    const host = url.hostname.toLowerCase();
    return ["fcm.googleapis.com","push.services.mozilla.com","notify.windows.com","push.apple.com","web.push.apple.com","push.opera.com"].some(
      (allowed) => host === allowed || host.endsWith("." + allowed)
    );
  } catch { return false; }
}

export async function POST(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const body = await request.json() as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; expirationTime?: unknown };
    if (!validEndpoint(body.endpoint) || typeof body.keys?.p256dh !== "string" || typeof body.keys?.auth !== "string"
      || body.keys.p256dh.length > 256 || body.keys.auth.length > 256) {
      return NextResponse.json({ error: "Invalid notification subscription." }, { status: 400 });
    }
    const db = createServiceClient();
    const endpointHash = await hashSubscriptionEndpoint(body.endpoint);
    const { data: existing, error: lookupError } = await db.from("web_push_subscriptions")
      .select("id,workspace_id").eq("endpoint_hash", endpointHash).maybeSingle();
    if (lookupError) throw lookupError;
    if (existing && existing.workspace_id !== workspace.id) {
      return NextResponse.json({ error: "This device is already linked to another workspace." }, { status: 409 });
    }
    const values = {
      workspace_id: workspace.id,
      user_id: workspace.owner_user_id,
      endpoint_hash: endpointHash,
      endpoint_encrypted: await encryptSubscriptionValue(body.endpoint),
      p256dh_encrypted: await encryptSubscriptionValue(body.keys.p256dh),
      auth_secret_encrypted: await encryptSubscriptionValue(body.keys.auth),
      expiration_time: typeof body.expirationTime === "number" ? body.expirationTime : null,
      updated_at: new Date().toISOString(),
    };
    const write = existing
      ? await db.from("web_push_subscriptions").update(values).eq("id", existing.id).eq("workspace_id", workspace.id)
      : await db.from("web_push_subscriptions").insert(values);
    if (write.error) throw write.error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[notifications] Subscription registration failed:", error);
    return NextResponse.json({ error: "Could not enable notifications." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const body = await request.json() as { endpoint?: unknown };
    if (!validEndpoint(body.endpoint)) return NextResponse.json({ error: "Invalid subscription." }, { status: 400 });
    const db = createServiceClient();
    const endpointHash = await hashSubscriptionEndpoint(body.endpoint);
    const { error } = await db.from("web_push_subscriptions").delete()
      .eq("workspace_id", workspace.id).eq("endpoint_hash", endpointHash);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[notifications] Subscription removal failed:", error);
    return NextResponse.json({ error: "We couldn’t turn off notifications on this device. Please try again." }, { status: 500 });
  }
}
