import { ImageResponse } from "next/og";
import { loadDraftPreviewInput } from "@/lib/integrations/telegram/draft-preview-data";
import { CANVAS_PX, fitDraftText, sampleEngagement } from "@/lib/integrations/telegram/draft-preview-html";

/**
 * The same LinkedIn-style draft image as the HTML preview, drawn directly to a
 * PNG with no headless browser. Telegram fetches this URL itself, so a draft
 * image can still be delivered when Browser Rendering is slow, rate limited or
 * down. Layout uses only what the renderer supports (flexbox, inline SVG).
 */

const MUTED = "rgba(0,0,0,0.6)";

/** Remote avatars are fetched with a short deadline; a slow image must never block the draft. */
async function avatarDataUri(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const type = response.headers.get("content-type") || "";
    if (!response.ok || !/^image\/(png|jpe?g)/i.test(type)) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 1_500_000) return null;
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return `data:${type.split(";")[0]};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

function Action({ label, path }: { label: string; path: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, color: MUTED, fontSize: 26 }}>
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
        <path d={path} />
      </svg>
      <span>{label}</span>
    </div>
  );
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const loaded = await loadDraftPreviewInput(request, id);
  if ("response" in loaded) return loaded.response;
  const { input } = loaded;

  const sample = sampleEngagement(input.seed);
  const fitted = fitDraftText(input.text);
  const avatar = await avatarDataUri(input.avatarUrl);
  const paragraphs = fitted.text.split("\n");
  const initial = (input.name.trim().charAt(0) || "Y").toUpperCase();

  return new ImageResponse(
    (
      <div style={{ width: CANVAS_PX, height: CANVAS_PX, background: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 1000, display: "flex", flexDirection: "column", background: "#fff", border: "2px solid #e3e1dd", borderRadius: 36, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "flex-start", padding: "36px 40px 0 40px" }}>
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} width={96} height={96} alt="" style={{ borderRadius: 48, objectFit: "cover" }} />
            ) : (
              <div style={{ width: 96, height: 96, borderRadius: 48, background: "#a8b3bd", color: "#fff", fontSize: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {initial}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", marginLeft: 22, paddingTop: 6, flex: 1 }}>
              <div style={{ fontSize: 34, lineHeight: "42px", color: "rgba(0,0,0,0.9)" }}>{input.name}</div>
              {input.headline ? (
                <div style={{ fontSize: 27, lineHeight: "36px", color: MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 700 }}>
                  {input.headline}
                </div>
              ) : null}
              <div style={{ fontSize: 27, lineHeight: "36px", color: MUTED }}>Now • 🌐</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", padding: "28px 40px 0 40px", fontSize: fitted.fontPx, lineHeight: 1.45, color: "rgba(0,0,0,0.9)" }}>
            {paragraphs.map((line, i) => (
              <div key={i} style={{ display: "flex", minHeight: Math.round(fitted.fontPx * 1.45), whiteSpace: "pre-wrap" }}>
                {line || " "}
              </div>
            ))}
            {fitted.truncated ? <div style={{ display: "flex", color: MUTED }}>…see more</div> : null}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", padding: "26px 40px 20px 40px", fontSize: 25, color: MUTED }}>
            <div style={{ display: "flex" }}>👍 {sample.reactions}</div>
            <div style={{ display: "flex" }}>
              {sample.comments} {sample.comments === 1 ? "comment" : "comments"}
              {sample.reposts > 0 ? ` • ${sample.reposts} ${sample.reposts === 1 ? "repost" : "reposts"}` : ""}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-around", padding: "20px 24px", borderTop: "2px solid #e3e1dd" }}>
            <Action label="Like" path="M7 10v11H3V10h4Zm0 0 4-7c1.5 0 2.5 1 2.2 2.6L12.6 9H19a2 2 0 0 1 2 2.4l-1.4 7.4A2 2 0 0 1 17.7 20H7" />
            <Action label="Comment" path="M4 5h16v11H11l-5 4v-4H4V5Z" />
            <Action label="Repost" path="M17 3l3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4" />
            <Action label="Send" path="M21 3 3 10.5l7 2.5 2.5 7L21 3ZM10 13l11-10" />
          </div>
        </div>
      </div>
    ),
    {
      width: CANVAS_PX,
      height: CANVAS_PX,
      headers: { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" },
    }
  );
}
