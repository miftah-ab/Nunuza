/**
 * Renders the LinkedIn-style draft image that Telegram sends for review.
 *
 * The reactions, comments and reposts on this image are SAMPLE numbers. They
 * are generated from the post id (so the same draft always shows the same
 * numbers, but each draft shows different ones) and every image says so.
 * They are never stored and never describe real performance.
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

const CSS = `
:root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:rgba(0,0,0,.9)}
*{box-sizing:border-box}body{margin:0;background:#f4f2ee;width:390px;padding:10px 0 14px}
.card{background:#fff;border-top:1px solid #e0dfdc;border-bottom:1px solid #e0dfdc}
.author{display:flex;gap:8px;padding:12px 16px 0;align-items:flex-start}
.avatar{width:48px;height:48px;flex:0 0 48px;border-radius:50%;background:#a8b3bd;display:flex;align-items:flex-end;justify-content:center;overflow:hidden;object-fit:cover}
.avatar svg{margin-bottom:-4px}
.who{flex:1;min-width:0}.name{font-size:14px;font-weight:600;line-height:20px}
.sub{font-size:12px;line-height:16px;color:rgba(0,0,0,.6)}.headline{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sub.row{display:flex;align-items:center;gap:3px;margin-top:1px}
.dots{color:rgba(0,0,0,.6);font-size:20px;letter-spacing:1px;line-height:16px;font-weight:700}
.text{padding:10px 16px 12px;font-size:14px;line-height:20px;white-space:pre-wrap;overflow-wrap:anywhere}
.counts{display:flex;align-items:center;justify-content:space-between;padding:0 16px 8px;font-size:12px;color:rgba(0,0,0,.6);line-height:16px}
.rx{display:flex;align-items:center}.ri{width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;border:1.5px solid #fff;margin-right:-4px}
.rx .n{margin-left:9px}
.bar{margin:0 8px;border-top:1px solid #e8e6e1;display:flex;justify-content:space-between;padding:2px 0}
.act{flex:1;display:flex;flex-direction:column;align-items:center;gap:1px;padding:8px 0 7px;color:rgba(0,0,0,.6);font-size:12px;font-weight:600}
.act svg{display:block}
.sample{margin:10px 16px 0;text-align:center;font-size:11px;line-height:15px;color:rgba(0,0,0,.55)}
.sample b{display:inline-block;margin-right:4px;padding:1px 6px;border-radius:9px;background:#e8e6e1;color:rgba(0,0,0,.7);font-weight:600}
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
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>LinkedIn draft preview</title><style>${CSS}</style></head><body>
<article class="card">
<header class="author">${avatar}<div class="who"><div class="name">${escapeHtml(input.name)}</div>${headline}<div class="sub row">Now &nbsp;•&nbsp; ${SVG.globe}</div></div><div class="dots">•••</div></header>
<div class="text">${escapeHtml(input.text)}</div>
<div class="counts"><div class="rx">${icons}<span class="n">${sample.reactions}</span></div><div>${sample.comments} ${sample.comments === 1 ? "comment" : "comments"}${reposts}</div></div>
<div class="bar"><div class="act">${SVG.thumb}Like</div><div class="act">${SVG.comment}Comment</div><div class="act">${SVG.repost}Repost</div><div class="act">${SVG.send}Send</div></div>
</article>
<div class="sample"><b>Sample</b>Reactions are sample numbers for this preview. Nothing is published.</div>
</body></html>`;
}
