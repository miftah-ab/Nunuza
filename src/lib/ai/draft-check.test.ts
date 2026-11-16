import { describe, expect, it } from "vitest";
import { checkDraftAgainstSource } from "./draft-check";

const source = {
  text: "Acme raises $12 million to expand logistics; shipping costs fell 8% in 2025.",
  urls: ["https://news.example.com/acme-raises", "https://example.com"],
};

describe("checkDraftAgainstSource", () => {
  it("accepts figures and links that come from the source", () => {
    const result = checkDraftAgainstSource("Acme raised $12 million and costs fell 8%. https://news.example.com/acme-raises", source);
    expect(result).toEqual({ ok: true, issues: [] });
  });

  it("ignores years and small counts", () => {
    expect(checkDraftAgainstSource("Three lessons from 2026.", source).ok).toBe(true);
  });

  it("flags a figure that is not in the source", () => {
    const result = checkDraftAgainstSource("Costs fell 40% across the industry.", source);
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain("40%");
  });

  it("flags a link to another site", () => {
    const result = checkDraftAgainstSource("Read more at https://spam.example.org/x", source);
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain("spam.example.org");
  });

  it("treats evergreen posts as having no allowed figures or links", () => {
    const evergreen = { text: "", urls: [] };
    expect(checkDraftAgainstSource("Clear writing beats clever writing.", evergreen).ok).toBe(true);
    expect(checkDraftAgainstSource("Teams ship 3x faster, 250 percent more.", evergreen).ok).toBe(false);
  });
});
