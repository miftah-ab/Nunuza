import { describe, expect, it } from "vitest";
import {
  assertNoExcludedPhrase,
  findExcludedPhrase,
  StrategyExclusionError,
} from "./exclusions";

describe("strategy exclusion guard", () => {
  it("matches configured exclusions case-insensitively", () => {
    expect(findExcludedPhrase("A post about POLITICAL commentary", ["political commentary"]))
      .toBe("political commentary");
  });

  it("normalizes repeated whitespace before matching", () => {
    expect(findExcludedPhrase("Competitor     attacks are not allowed", ["competitor attacks"]))
      .toBe("competitor attacks");
  });

  it("allows unrelated topics and empty exclusion lists", () => {
    expect(findExcludedPhrase("Building a reliable SaaS product", ["politics", "religion"]))
      .toBeNull();
    expect(findExcludedPhrase("Any topic", [])).toBeNull();
  });

  it("rejects matching content with a typed domain error", () => {
    expect(() => assertNoExcludedPhrase("A post about religion", ["religion"], "draft request"))
      .toThrow(StrategyExclusionError);
  });

  it("ignores very short exclusions to avoid broad accidental matches", () => {
    expect(findExcludedPhrase("A post about AI tools", ["AI"])).toBeNull();
  });
});
