import { describe, expect, it } from "vitest";
import { renderDraftPreviewHtml, sampleEngagement } from "./draft-preview-html";

describe("draft preview sample engagement", () => {
  it("is stable for one draft", () => {
    expect(sampleEngagement("post-1")).toEqual(sampleEngagement("post-1"));
  });

  it("differs between drafts", () => {
    const ids = Array.from({ length: 30 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const counts = new Set(ids.map((id) => sampleEngagement(id).reactions));
    expect(counts.size).toBeGreaterThan(10);
  });

  it("stays inside believable ranges", () => {
    for (let i = 0; i < 200; i += 1) {
      const s = sampleEngagement(`seed-${i}`);
      expect(s.reactions).toBeGreaterThanOrEqual(12);
      expect(s.reactions).toBeLessThanOrEqual(180);
      expect(s.comments).toBeGreaterThanOrEqual(1);
      expect(s.comments).toBeLessThan(s.reactions);
      expect(s.reposts).toBeGreaterThanOrEqual(0);
      expect(s.reposts).toBeLessThanOrEqual(6);
      expect(s.icons[0]).toBe("like");
      expect(new Set(s.icons).size).toBe(s.icons.length);
    }
  });
});

describe("renderDraftPreviewHtml", () => {
  const base = { name: "Ada", headline: null, avatarUrl: null, text: "Hello", seed: "post-1" };

  it("labels every image as sample", () => {
    for (const seed of ["a", "b", "c", "d"]) {
      const html = renderDraftPreviewHtml({ ...base, seed });
      expect(html).toContain('<span class="tag">Sample</span>');
      expect(html).not.toContain("Nothing is published");
    }
  });

  it("escapes draft text, name and headline", () => {
    const html = renderDraftPreviewHtml({ ...base, name: "<b>x</b>", headline: "<i>h</i>", text: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<i>h</i>");
    expect(html).toContain("&lt;script&gt;");
  });
});
