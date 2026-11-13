import { createServiceClient } from "@/lib/supabase/server";


function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] || character);
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
    return new Response("This draft preview link is invalid or expired.", { status: 401 });
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
  if (!valid) return new Response("This draft preview link is invalid or expired.", { status: 401 });
  const supabase = createServiceClient();
  const { data: post, error } = await supabase.from("content_posts")
    .select("id, internal_title, text, status").eq("id", id).maybeSingle();
  if (error || !post || post.status !== "draft") {
    return new Response("This draft is no longer available. Open Nunuza to review your drafts.", { status: 404 });
  }
  const title = escapeHtml(post.internal_title || "LinkedIn post");
  const body = escapeHtml(post.text || "");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${title} · LinkedIn post preview</title><style>
:root{color-scheme:light;font-family:Arial,Helvetica,sans-serif;background:#f3f2ef;color:#191919}
*{box-sizing:border-box}body{margin:0;padding:34px 20px;background:#f3f2ef}.shell{max-width:680px;margin:0 auto}
.card{background:#fff;border:1px solid #d9d9d9;border-radius:12px;overflow:hidden}
.head{display:flex;align-items:center;gap:12px;padding:20px 22px 16px}
.avatar{width:52px;height:52px;flex:0 0 52px;border-radius:50%;display:grid;place-items:center;background:#dce6f1;color:#245078;font-size:17px;font-weight:700}
.identity{min-width:0}.name{font-size:16px;font-weight:700;line-height:1.35}.meta{font-size:13px;color:#666;margin-top:3px}
.state{margin-left:auto;align-self:flex-start;border:1px solid #c8d9ed;background:#f2f7fc;color:#245078;border-radius:20px;padding:6px 9px;font-size:11px;font-weight:700;white-space:nowrap}
.preview-label{padding:0 22px 16px;color:#0a66c2;font-size:13px;font-weight:700}
.post-title{padding:0 22px 12px;font-size:21px;line-height:1.35;font-weight:700;overflow-wrap:anywhere}
.post-body{padding:0 22px 22px;font-size:16px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}
.divider{height:1px;background:#e6e6e6;margin:0 22px}
.reactions{padding:13px 22px;color:#666;font-size:13px;display:flex;justify-content:space-between;gap:10px}
.reaction-icons{color:#326fa8;letter-spacing:1px}.preview-only{font-weight:600;color:#707070}
.actions{border-top:1px solid #e6e6e6;padding:13px 12px;display:flex;justify-content:space-around;gap:8px;color:#666;font-size:14px;font-weight:700}
.actions span{padding:8px 10px;white-space:nowrap}
.notice{margin:14px 4px 0;text-align:center;color:#6b6b6b;font-size:12px}
@media(max-width:520px){body{padding:18px 10px}.head{padding:17px 16px 14px}.preview-label{padding:0 16px 14px}.post-title{padding:0 16px 10px;font-size:19px}.post-body{padding:0 16px 18px;font-size:15px}.divider{margin:0 16px}.reactions{padding:12px 16px}.actions{font-size:12px}.actions span{padding:7px 4px}.state{font-size:10px;padding:5px 7px}}
</style></head><body><main class="shell">
<article class="card">
<header class="head"><div class="avatar">XYZ</div><div class="identity"><div class="name">XYZ</div><div class="meta">LinkedIn post preview · Just now</div></div><div class="state">Ready for review</div></header>
<div class="preview-label">LinkedIn post preview</div>
<div class="post-title">${title}</div>
<div class="post-body">${body}</div>
<div class="divider"></div>
<div class="reactions"><span><span class="reaction-icons">👍 ❤️ 👏</span> 123</span><span class="preview-only">Preview only</span></div>
<div class="actions"><span>Like</span><span>Comment</span><span>Repost</span><span>Send</span></div>
</article>
</main></body></html>`;
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  }});
}
