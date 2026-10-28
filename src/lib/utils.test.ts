import { describe, it, expect } from "vitest";
import { cn, truncate } from "@/lib/utils";
import { tokens } from "@/lib/tokens";

describe("cn() utility", () => {
  it("merges class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("deduplicates conflicting Tailwind classes (last wins)", () => {
    const result = cn("bg-red-500", "bg-blue-500");
    expect(result).toBe("bg-blue-500");
  });

  it("handles conditional classes", () => {
    expect(cn("base", false && "excluded", "included")).toBe("base included");
  });
});

describe("truncate() utility", () => {
  it("returns text unchanged when within limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates and appends ellipsis when over limit", () => {
    const result = truncate("hello world", 8);
    expect(result.length).toBeLessThanOrEqual(8);
    expect(result.endsWith("…")).toBe(true);
  });

  it("handles exact limit without truncating", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });
});

describe("design tokens", () => {
  it("exports the primary forest green hex value", () => {
    expect(tokens.colors.forest).toBe("#174C3C");
  });

  it("exports the ink primary text color", () => {
    expect(tokens.colors.ink).toBe("#202522");
  });

  it("exports all required status colors", () => {
    expect(tokens.colors.success).toBe("#287A50");
    expect(tokens.colors.warning).toBe("#A86412");
    expect(tokens.colors.error).toBe("#B93838");
  });
});
