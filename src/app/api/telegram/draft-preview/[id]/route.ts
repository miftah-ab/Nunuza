import { createServiceClient } from "@/lib/supabase/server";
import { renderDraftPreviewHtml } from "@/lib/integrations/telegram/draft-preview-html";

function safeImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const url = new URL(request.url);
  const expires = url.searchParams.get("expires") || "";
  const supplied = url.searchParams.get("signature") || "";
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  const expiry = Number(expires);
  const now = Math.floor(Date.now() / 1000);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^\d{10}$/.test(expires) ||
      !Number.isSafeInteger(expiry) || expiry < now || expiry > now + 8 * 24 * 60 * 60 ||
      !/^[a-f0-9]{64}$/i.test(supplied) || !secret) {
    return new Response("This draft image is invalid or expired.", { status: 401 });
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const signatureBytes = new Uint8Array(supplied.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    new TextEncoder().encode(`${id}.${expires}`)
  );
  if (!valid) return new Response("This draft image is invalid or expired.", { status: 401 });

  const supabase = createServiceClient();
  const { data: post, error } = await supabase.from("content_posts")
    .select("id, text, status, workspace_id")
    .eq("id", id).maybeSingle();
  if (error || !post || post.status !== "draft") {
    return new Response("This draft is no longer available.", { status: 404 });
  }

  // Identity priority: connected LinkedIn profile -> Nunuza profile -> neutral "You".
  // No email-derived names, generated initials, or invented profile details.
  const { data: workspace } = await supabase.from("workspaces")
    .select("owner_user_id").eq("id", post.workspace_id).maybeSingle();

  let linkedinName: string | null = null;
  let linkedinHeadline: string | null = null;
  let linkedinAvatar: string | null = null;
  let profileName: string | null = null;
  let profileAvatar: string | null = null;

  if (workspace?.owner_user_id) {
    const [{ data: connection }, { data: profile }] = await Promise.all([
      supabase.from("integration_connections")
        .select("status, metadata")
        .eq("workspace_id", post.workspace_id)
        .eq("provider", "linkedin")
        .maybeSingle(),
      supabase.from("profiles")
        .select("display_name, avatar_url")
        .eq("id", workspace.owner_user_id)
        .maybeSingle(),
    ]);

    if (connection?.status === "connected") {
      const metadata = connection.metadata && typeof connection.metadata === "object"
        ? connection.metadata as Record<string, unknown>
        : {};
      linkedinName = firstString(metadata.name);
      linkedinHeadline = firstString(metadata.headline);
      linkedinAvatar = safeImageUrl(firstString(metadata.picture, metadata.avatar_url));
    }
    profileName = firstString(profile?.display_name);
    profileAvatar = safeImageUrl(profile?.avatar_url);
  }

  const displayName = linkedinName || profileName || "You";
  const html = renderDraftPreviewHtml({
    name: displayName,
    headline: linkedinName ? linkedinHeadline : null,
    avatarUrl: linkedinAvatar || profileAvatar,
    text: post.text || "",
    seed: post.id,
  });
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  }});
}
