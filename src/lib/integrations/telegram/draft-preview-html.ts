/**
 * Renders the LinkedIn-style draft image that Telegram sends for review.
 *
 * The reactions, comments and reposts on this image are SAMPLE numbers. They
 * are generated from the post id (so the same draft always shows the same
 * numbers, but each draft shows different ones). By the founder's choice the
 * image shows only the draft, with no extra labels. They are never stored and
 * never describe real performance.
 */

export interface SampleEngagement {
  reactions: number;
  comments: number;
  reposts: number;
  /** Reaction icons shown next to the count, most common first. */
  icons: Array<"like" | "celebrate" | "love" | "insightful">;
}

function hashSeed(seed: string): number {
  // FNV-1a, 32 bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleEngagement(seed: string): SampleEngagement {
  const next = mulberry32(hashSeed(seed));
  const reactions = 12 + Math.floor(next() * 169); // 12-180
  const comments = Math.max(1, Math.round(reactions * (0.04 + next() * 0.1)));
  const reposts = Math.floor(next() * 7); // 0-6
  const extras = (["celebrate", "love", "insightful"] as const)
    .map((icon) => ({ icon, order: next() }))
    .sort((a, b) => a.order - b.order)
    .slice(0, next() < 0.5 ? 1 : 2)
    .map((entry) => entry.icon);
  return { reactions, comments, reposts, icons: ["like", ...extras] };
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] || character);
}

const SVG = {
  thumb: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M7 10v11H3V10h4Zm0 0 4-7c1.5 0 2.5 1 2.2 2.6L12.6 9H19a2 2 0 0 1 2 2.4l-1.4 7.4A2 2 0 0 1 17.7 20H7"/></svg>',
  comment: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M4 5h16v11H11l-5 4v-4H4V5Z"/><path d="M8 9h8M8 12h5"/></svg>',
  repost: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M17 3l3 3-3 3"/><path d="M4 11V9a3 3 0 0 1 3-3h13"/><path d="M7 21l-3-3 3-3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/></svg>',
  send: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M21 3 3 10.5l7 2.5 2.5 7L21 3Z"/><path d="M10 13l11-10"/></svg>',
  globe: '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm4.9 6.2h-2.2a10 10 0 0 0-1-3.6 5.6 5.6 0 0 1 3.2 3.6ZM8 2.5c.6.6 1.3 2 1.6 4.7H6.4C6.7 4.5 7.4 3.1 8 2.5ZM6.3 3.6a10 10 0 0 0-1 3.6H3.1a5.6 5.6 0 0 1 3.2-3.6ZM3.1 8.8h2.2a10 10 0 0 0 1 3.6 5.6 5.6 0 0 1-3.2-3.6Zm4.9 4.7c-.6-.6-1.3-2-1.6-4.7h3.2c-.3 2.7-1 4.1-1.6 4.7Zm1.7-1.1a10 10 0 0 0 1-3.6h2.2a5.6 5.6 0 0 1-3.2 3.6Z"/></svg>',
  user: '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><circle cx="12" cy="8.5" r="4" fill="#fff"/><path d="M4 21c.6-4.4 3.8-6.6 8-6.6s7.4 2.2 8 6.6" fill="#fff"/></svg>',
};

const REACTION_ICON: Record<SampleEngagement["icons"][number], string> = {
  like: '<span class="ri" style="background:#378fe9"><svg viewBox="0 0 24 24" width="11" height="11" fill="#fff"><path d="M7 10v11H3V10h4Zm1 0 3.6-7c1.6 0 2.6 1.1 2.3 2.7L13.4 9H19a2 2 0 0 1 2 2.4l-1.3 7.2A2 2 0 0 1 17.8 20H8V10Z"/></svg></span>',
  celebrate: '<span class="ri" style="background:#6dae4f"><svg viewBox="0 0 24 24" width="11" height="11" fill="#fff"><path d="M4 20 8 8l8 8-12 4Z"/><path d="M14 4l1 2.5 2.5 1-2.5 1L14 11l-1-2.5-2.5-1 2.5-1L14 4Z"/></svg></span>',
  love: '<span class="ri" style="background:#df704d"><svg viewBox="0 0 24 24" width="11" height="11" fill="#fff"><path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11Z"/></svg></span>',
  insightful: '<span class="ri" style="background:#f5bb5c"><svg viewBox="0 0 24 24" width="11" height="11" fill="#fff"><path d="M12 2a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 2Zm-2.5 16h5v1.5a2.5 2.5 0 0 1-5 0V18Z"/></svg></span>',
};

/** Telegram shows a square photo in full in the chat; a tall one is cropped until tapped. */
export const CANVAS_PX = 1080;
const CARD_PX = 1000;
const TEXT_PAD_PX = 40;
const TEXT_MAX_PX = 620;
const TEXT_WIDTH_PX = CARD_PX - TEXT_PAD_PX * 2;
const LINE_HEIGHT = 1.45;
const AVG_CHAR_EM = 0.54;

export interface FittedText {
  text: string;
  fontPx: number;
  truncated: boolean;
}

function estimateLines(text: string, fontPx: number): number {
  const perLine = Math.max(8, Math.floor(TEXT_WIDTH_PX / (fontPx * AVG_CHAR_EM)));
  return text.split("\n").reduce((sum, paragraph) => sum + Math.max(1, Math.ceil(paragraph.length / perLine)), 0);
}

/**
 * Picks the largest readable font size at which the whole draft fits the
 * square card. If it still does not fit at the smallest size, cuts the text
 * at a word boundary and marks it "see more", like LinkedIn does, so the image
 * stays square. The full draft is always sent in the Telegram message itself.
 */
export function fitDraftText(raw: string): FittedText {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  for (let fontPx = 32; fontPx >= 24; fontPx -= 2) {
    if (estimateLines(text, fontPx) * fontPx * LINE_HEIGHT <= TEXT_MAX_PX) {
      return { text, fontPx, truncated: false };
    }
  }
  const fontPx = 24;
  const maxLines = Math.floor(TEXT_MAX_PX / (fontPx * LINE_HEIGHT)) - 1;
  const perLine = Math.max(8, Math.floor(TEXT_WIDTH_PX / (fontPx * AVG_CHAR_EM)));
  const kept: string[] = [];
  let used = 0;
  for (const paragraph of text.split("\n")) {
    const lines = Math.max(1, Math.ceil(paragraph.length / perLine));
    if (used + lines <= maxLines) {
      kept.push(paragraph);
      used += lines;
      continue;
    }
    const room = (maxLines - used) * perLine;
    if (room > 20) {
      const cut = paragraph.slice(0, room);
      const lastSpace = cut.lastIndexOf(" ");
      kept.push((lastSpace > room * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd());
    }
    break;
  }
  return { text: kept.join("\n").trimEnd(), fontPx, truncated: true };
}

const CSS = `
:root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:rgba(0,0,0,.9)}
*{box-sizing:border-box}
html,body{margin:0;background:#fff}
body{width:${CANVAS_PX}px;height:${CANVAS_PX}px;overflow:hidden;display:flex;align-items:center;justify-content:center}
.card{width:${CARD_PX}px;background:#fff;border:1.5px solid #e3e1dd;border-radius:36px;box-shadow:0 10px 34px rgba(0,0,0,.13);overflow:hidden}
.author{display:flex;gap:22px;padding:36px 40px 0;align-items:flex-start}
.avatar{width:96px;height:96px;flex:0 0 96px;border-radius:50%;background:#a8b3bd;display:flex;align-items:flex-end;justify-content:center;overflow:hidden;object-fit:cover}
.avatar svg{width:64px;height:64px;margin-bottom:-8px}
.who{flex:1;min-width:0;padding-top:6px}.name{font-size:34px;font-weight:600;line-height:42px}
.sub{font-size:27px;line-height:36px;color:rgba(0,0,0,.6)}.headline{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sub.row{display:flex;align-items:center;gap:8px}.sub.row svg{width:28px;height:28px}
.dots{color:rgba(0,0,0,.6);font-size:40px;letter-spacing:2px;line-height:30px;font-weight:700}
.text{padding:30px ${TEXT_PAD_PX}px 26px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;max-height:${TEXT_MAX_PX + 60}px;overflow:hidden}
.more{color:rgba(0,0,0,.6);white-space:nowrap}
.counts{display:flex;align-items:center;justify-content:space-between;padding:0 40px 20px;font-size:27px;color:rgba(0,0,0,.6);line-height:36px}
.rx{display:flex;align-items:center}.ri{width:38px;height:38px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;border:3px solid #fff;margin-right:-10px}
.ri svg{width:22px;height:22px}
.rx .n{margin-left:20px}
.bar{margin:0 20px;border-top:2px solid #eceae6;display:flex;justify-content:space-between;padding:8px 0 14px}
.act{flex:1;display:flex;align-items:center;justify-content:center;gap:14px;padding:18px 0;color:rgba(0,0,0,.6);font-size:30px;font-weight:600}
.act svg{display:block;width:42px;height:42px}
`;

export interface DraftPreviewInput {
  name: string;
  headline: string | null;
  /** Must already be a validated https URL. */
  avatarUrl: string | null;
  text: string;
  /** Stable per-draft value (the post id) that drives the sample numbers. */
  seed: string;
}

export function renderDraftPreviewHtml(input: DraftPreviewInput): string {
  const sample = sampleEngagement(input.seed);
  const fitted = fitDraftText(input.text);
  const avatar = input.avatarUrl
    ? `<img class="avatar" src="${escapeHtml(input.avatarUrl)}" alt="">`
    : `<div class="avatar" aria-label="Default profile image">${SVG.user}</div>`;
  const headline = input.headline
    ? `<div class="sub headline">${escapeHtml(input.headline)}</div>`
    : "";
  const icons = sample.icons.map((icon) => REACTION_ICON[icon]).join("");
  const reposts = sample.reposts > 0
    ? ` &nbsp;•&nbsp; ${sample.reposts} ${sample.reposts === 1 ? "repost" : "reposts"}`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=1080"><meta name="robots" content="noindex,nofollow">
<title>LinkedIn draft preview</title><style>${CSS}</style></head><body>
<article class="card">
<header class="author">${avatar}<div class="who"><div class="name">${escapeHtml(input.name)}</div>${headline}<div class="sub row">Now &nbsp;•&nbsp; ${SVG.globe}</div></div><div class="dots">•••</div></header>
<div class="text" style="font-size:${fitted.fontPx}px">${escapeHtml(fitted.text)}${fitted.truncated ? '<span class="more">…&nbsp;see more</span>' : ""}</div>
<div class="counts"><div class="rx">${icons}<span class="n">${sample.reactions}</span></div><div>${sample.comments} ${sample.comments === 1 ? "comment" : "comments"}${reposts}</div></div>
<div class="bar"><div class="act">${SVG.thumb}Like</div><div class="act">${SVG.comment}Comment</div><div class="act">${SVG.repost}Repost</div><div class="act">${SVG.send}Send</div></div>
</article>
</body></html>`;
}
