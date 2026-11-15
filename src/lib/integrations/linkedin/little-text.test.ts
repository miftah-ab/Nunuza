import { describe, expect, it } from "vitest";
import { escapeLinkedInCommentary } from "./little-text";

describe("escapeLinkedInCommentary", () => {
  it("leaves ordinary text, punctuation and line breaks untouched", () => {
    const text = "Hello, world! This works.\n\nSecond paragraph: 50% better, $10 — done?";
    expect(escapeLinkedInCommentary(text)).toBe(text);
  });

  it("escapes parentheses and brackets that used to cut posts off", () => {
    expect(escapeLinkedInCommentary("We shipped it (finally) [v2]")).toBe(
      "We shipped it \\(finally\\) \\[v2\\]"
    );
  });

  it("escapes every reserved character", () => {
    expect(escapeLinkedInCommentary("a|b{c}d@e<f>g*h_i~j\\k")).toBe(
      "a\\|b\\{c\\}d\\@e\\<f\\>g\\*h\\_i\\~j\\\\k"
    );
  });

  it("turns hashtags into the documented hashtag template", () => {
    expect(escapeLinkedInCommentary("Hello #MyTestTag")).toBe("Hello {hashtag|\\#|MyTestTag}");
    expect(escapeLinkedInCommentary("#AI and #Leadership")).toBe(
      "{hashtag|\\#|AI} and {hashtag|\\#|Leadership}"
    );
  });

  it("escapes reserved characters inside a hashtag tag", () => {
    expect(escapeLinkedInCommentary("#my_tag")).toBe("{hashtag|\\#|my\\_tag}");
  });

  it("keeps '#' as escaped plain text when it is not a hashtag", () => {
    expect(escapeLinkedInCommentary("Rank #1 today")).toBe("Rank \\#1 today");
    expect(escapeLinkedInCommentary("I write C# daily")).toBe("I write C\\# daily");
    expect(escapeLinkedInCommentary("a # b")).toBe("a \\# b");
  });

  it("handles non-latin hashtags", () => {
    expect(escapeLinkedInCommentary("#Ethiopia #አዲስ")).toBe(
      "{hashtag|\\#|Ethiopia} {hashtag|\\#|አዲስ}"
    );
  });

  it("produces a body LinkedIn reads back as the original single backslashes", () => {
    const body = JSON.parse(JSON.stringify({ commentary: escapeLinkedInCommentary("(a)") }));
    expect(body.commentary).toBe("\\(a\\)");
  });
});
