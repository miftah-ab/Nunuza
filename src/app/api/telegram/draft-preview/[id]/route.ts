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
<title>${title} · Nunuza Draft Preview</title><style>
:root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f3f5f7;color:#191919}
*{box-sizing:border-box}body{margin:0;padding:32px 16px}.shell{max-width:720px;margin:0 auto}
.brand{display:flex;align-items:center;gap:12px;margin:0 0 18px;color:#536171;font-size:13px;font-weight:700;letter-spacing:.08em}
.mark{display:grid;place-items:center;width:36px;height:36px;border-radius:11px;background:#14263d;color:#fff;font-size:18px}
.card{background:#fff;border:1px solid #e4e8ed;border-radius:18px;box-shadow:0 12px 36px #14263d12;overflow:hidden}
.head{padding:24px 28px 18px;border-bottom:1px solid #edf0f3}.eyebrow{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0a66c2}
h1{font-size:22px;line-height:1.3;margin:10px 0 0;overflow-wrap:anywhere}
.content{padding:26px 28px 30px;font-size:16px;line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere}
.footer{border-top:1px solid #edf0f3;padding:16px 28px;color:#687586;font-size:12px;display:flex;justify-content:space-between;gap:12px}
.notice{margin:16px 4px 0;text-align:center;color:#687586;font-size:13px}
@media(max-width:520px){body{padding:16px 10px}.head{padding:20px}.content{padding:20px;font-size:15px}.footer{padding:14px 20px}h1{font-size:20px}}
</style></head><body><main class="shell"><div class="brand"><span class="mark">N</span><span>NUNUZA · LINKEDIN DRAFT</span></div>
<article class="card"><header class="head"><div class="eyebrow">Draft preview · Not published</div><h1>${title}</h1></header>
<div class="content">${body}</div><footer class="footer"><span>Saved in Nunuza</span><span>Approval required before publishing</span></footer></article>
<p class="notice">This is a private, time-limited preview link. Nothing on this page publishes your post.</p></main></body></html>`;
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  }});
}
