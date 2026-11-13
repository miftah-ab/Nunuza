import { describe, expect, it } from "vitest";
import { normalizeLinkedInPostText } from "./plain-text";

describe("normalizeLinkedInPostText", () => {
  it("removes bold, italic, underline-style, and strikethrough Markdown", () => {
    expect(normalizeLinkedInPostText("This is **bold**, *italic*, __underlined__, ~~old~~."))
      .toBe("This is bold, italic, underlined, old.");
  });

  it("removes malformed or unmatched asterisk markers", () => {
    expect(normalizeLinkedInPostText("**A strong hook**\n\nThis is **important**.\n\n**"))
      .toBe("A strong hook\n\nThis is important.");
    expect(normalizeLinkedInPostText("A sentence ending with **"))
      .toBe("A sentence ending with");
  });

  it("preserves paragraphs, punctuation, URLs, and ordinary multiplication", () => {
    expect(normalizeLinkedInPostText("One paragraph.\n\nRead https://example.com\n\n2 * 3 = 6."))
      .toBe("One paragraph.\n\nRead https://example.com\n\n2 * 3 = 6.");
  });

  it("converts Markdown links to readable plain text", () => {
    expect(normalizeLinkedInPostText("Read [the report](https://example.com/report)."))
      .toBe("Read the report (https://example.com/report).");
  });

  it("removes headings, quote markers, and code fences without dropping content", () => {
    expect(normalizeLinkedInPostText("\`\`\`markdown\n## Key lesson\n> Build for users.\n\`\`\`"))
      .toBe("Key lesson\nBuild for users.");
  });

  it("is safe to run more than once", () => {
    const once = normalizeLinkedInPostText("**Clean**\n\nText.");
    expect(normalizeLinkedInPostText(once)).toBe(once);
  });
});
