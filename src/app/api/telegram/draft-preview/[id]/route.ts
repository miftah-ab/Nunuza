import { createServiceClient } from "@/lib/supabase/server";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] || character);
}

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

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "LI";
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

  // Use the connected LinkedIn identity first, then the user's Supabase profile.
  // Never invent a placeholder identity such as "XYZ".
  const { data: workspace } = await supabase.from("workspaces")
    .select("owner_user_id").eq("id", post.workspace_id).maybeSingle();
  let displayName = "LinkedIn member";
  let headline = "";
  let avatarUrl: string | null = null;
  if (workspace?.owner_user_id) {
    const { data: authResult } = await supabase.auth.admin.getUserById(workspace.owner_user_id);
    const user = authResult?.user;
    if (user) {
      const identities = Array.isArray(user.identities) ? user.identities : [];
      const linkedinIdentity = identities.find((identity: any) =>
        ["linkedin_oidc", "linkedin"].includes(String(identity?.provider || "").toLowerCase())
      );
      const identityData = linkedinIdentity?.identity_data || {};
      const metadata = user.user_metadata || {};
      displayName = firstString(
        identityData.name, identityData.full_name, identityData.given_name && identityData.family_name
          ? `${identityData.given_name} ${identityData.family_name}` : null,
        metadata.full_name, metadata.name, metadata.display_name,
        user.email?.split("@")[0]
      ) || displayName;
      headline = firstString(identityData.headline, metadata.headline, metadata.bio) || "";
      avatarUrl = safeImageUrl(firstString(
        identityData.picture, identityData.avatar_url, metadata.avatar_url, metadata.picture
      ));
    }
  }

  const safeName = escapeHtml(displayName);
  const safeHeadline = escapeHtml(headline);
  const safeAvatarUrl = avatarUrl ? escapeHtml(avatarUrl) : null;
  const avatar = safeAvatarUrl
    ? `<img class="avatar" src="${safeAvatarUrl}" alt="">`
    : `<div class="avatar fallback">${escapeHtml(initials(displayName))}</div>`;
  const body = escapeHtml(post.text || "");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>LinkedIn</title><style>
:root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f3f2ef;color:rgba(0,0,0,.9)}
*{box-sizing:border-box}body{margin:0;background:#f3f2ef}.topbar{height:72px;background:#fff;border-bottom:1px solid #e0dfdc;display:flex;align-items:center;justify-content:center}
.nav{width:100%;max-width:1128px;padding:0 22px;display:flex;align-items:center;gap:12px}.logo{width:36px;height:36px;border-radius:4px;background:#0a66c2;color:#fff;font-weight:800;font-size:27px;line-height:36px;text-align:center;letter-spacing:-2px}
.search{height:36px;width:280px;border:0;border-radius:4px;background:#edf3f8;padding:0 14px;color:#666;font-size:14px}.navitems{margin-left:auto;display:flex;align-items:center;gap:27px;color:#666;font-size:11px}
.navitem{text-align:center;min-width:42px;white-space:nowrap}.navicon{font-size:21px;line-height:25px;color:#666}.feed{max-width:760px;margin:28px auto;padding:0 16px}
.card{background:#fff;border:1px solid rgba(0,0,0,.12);border-radius:9px;overflow:hidden}
.author{display:flex;align-items:flex-start;gap:10px;padding:18px 18px 0}
.avatar{width:56px;height:56px;flex:0 0 56px;border-radius:50%;object-fit:cover;background:#e7e9ec}
.fallback{display:flex;align-items:center;justify-content:center;color:#fff;background:#647d91;font-size:18px;font-weight:600}
.identity{min-width:0;flex:1}.name{font-size:16px;font-weight:600;line-height:21px;color:rgba(0,0,0,.9)}
.headline{font-size:13px;line-height:18px;color:rgba(0,0,0,.6);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.postmeta{font-size:12px;line-height:18px;color:rgba(0,0,0,.6);margin-top:2px}.more{font-size:24px;color:#666;line-height:20px;padding:0 4px}
.post-content{padding:16px 18px 18px;font-size:16px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;color:rgba(0,0,0,.9)}
.engagement{border-top:1px solid #e8e8e8;margin:0 18px;padding:12px 0;display:flex;justify-content:space-between;align-items:center;color:#666;font-size:12px}
.reaction-icons{font-size:15px;letter-spacing:-3px;margin-right:5px}.actions{border-top:1px solid #e8e8e8;padding:4px 10px;display:flex;justify-content:space-around}
.action{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:13px 4px;color:#666;font-size:14px;font-weight:600;white-space:nowrap}
.action-icon{font-size:19px;line-height:20px}
@media(max-width:620px){.nav{padding:0 14px}.search{width:150px}.navitems{gap:12px}.navitem:nth-child(2),.navitem:nth-child(3){display:none}.feed{margin:12px auto;padding:0 8px}.author{padding:15px 14px 0}.post-content{padding:14px;font-size:15px}.engagement{margin:0 14px}.action{font-size:12px;gap:5px}}
</style></head><body>
<header class="topbar"><nav class="nav"><div class="logo">in</div><div class="search">⌕ &nbsp; Search</div><div class="navitems">
<div class="navitem"><div class="navicon">⌂</div>Home</div><div class="navitem"><div class="navicon">♧</div>My Network</div><div class="navitem"><div class="navicon">▣</div>Jobs</div><div class="navitem"><div class="navicon">▤</div>Messaging</div><div class="navitem"><div class="navicon">♧</div>Notifications</div><div class="navitem"><div class="navicon">●</div>Me</div>
</div></nav></header>
<main class="feed"><article class="card">
<header class="author">${avatar}<div class="identity"><div class="name">${safeName}</div>${safeHeadline ? `<div class="headline">${safeHeadline}</div>` : ""}<div class="postmeta">Just now · 🌐</div></div><div class="more">•••</div></header>
<div class="post-content">${body}</div>
<div class="engagement"><span><span class="reaction-icons">👍 ❤️ 👏</span></span><span>Like · Comment</span></div>
<div class="actions"><div class="action"><span class="action-icon">♧</span>Like</div><div class="action"><span class="action-icon">▱</span>Comment</div><div class="action"><span class="action-icon">⟳</span>Repost</div><div class="action"><span class="action-icon">➤</span>Send</div></div>
</article></main></body></html>`;
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  }});
}
