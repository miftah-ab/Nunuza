import { ImageResponse } from "next/og";

interface TelegramDraftPreviewInput {
  title: string;
  text: string;
  revised?: boolean;
}

function estimateLines(text: string): number {
  return text.split("\n").reduce((total, paragraph) => {
    if (!paragraph.trim()) return total + 1;
    return total + Math.max(1, Math.ceil(paragraph.length / 57));
  }, 0);
}

export async function renderTelegramDraftPreview(
  input: TelegramDraftPreviewInput
): Promise<Uint8Array> {
  const title = input.title.trim().slice(0, 180) || "LinkedIn post";
  const body = input.text.trim();
  const lineCount = estimateLines(body);
  const height = Math.min(4096, Math.max(900, 560 + lineCount * 43));
  const response = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#f3f2ef",
          padding: "44px",
          fontFamily: "Arial",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            backgroundColor: "#ffffff",
            border: "2px solid #dedede",
            borderRadius: "24px",
            padding: "42px",
            boxShadow: "0 12px 36px rgba(0,0,0,0.10)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", marginBottom: "34px" }}>
            <div
              style={{
                width: "76px",
                height: "76px",
                borderRadius: "50%",
                backgroundColor: "#e7e7e7",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#555555",
                fontSize: "34px",
                marginRight: "22px",
              }}
            >
              N
            </div>
            <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <div style={{ fontSize: "30px", fontWeight: 700, color: "#191919" }}>Your LinkedIn post</div>
              <div style={{ fontSize: "22px", color: "#666666", marginTop: "7px" }}>Preview · Not published · Just now</div>
            </div>
            <div style={{ fontSize: "22px", color: "#0a66c2", fontWeight: 700 }}>in</div>
          </div>
          <div style={{ fontSize: "30px", lineHeight: 1.25, fontWeight: 700, color: "#191919", marginBottom: "22px" }}>
            {title}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              fontSize: "27px",
              lineHeight: 1.42,
              color: "#252525",
              flex: 1,
            }}
          >
            {body}
          </div>
          <div style={{ marginTop: "34px", borderTop: "2px solid #eeeeee", paddingTop: "22px", display: "flex", justifyContent: "space-between", color: "#666666", fontSize: "21px" }}>
            <div style={{ display: "flex" }}>👍 ❤️ 👏 <span style={{ marginLeft: "12px" }}>Preview only</span></div>
            <div>{input.revised ? "Revised draft" : "New draft"}</div>
          </div>
          <div style={{ marginTop: "22px", borderTop: "2px solid #eeeeee", paddingTop: "22px", display: "flex", justifyContent: "space-around", color: "#666666", fontSize: "23px" }}>
            <div>♧ Like</div>
            <div>▢ Comment</div>
            <div>⇄ Repost</div>
            <div>➤ Send</div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "center", marginTop: "22px", fontSize: "20px", color: "#666666" }}>
          NUNUZA · DRAFT PREVIEW
        </div>
      </div>
    ),
    { width: 1080, height, headers: { "Cache-Control": "no-store" } }
  );
  return new Uint8Array(await response.arrayBuffer());
}
