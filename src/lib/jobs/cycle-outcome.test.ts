import { describe, expect, it } from "vitest";
import { describeCycleOutcome } from "./cycle-outcome";

describe("describeCycleOutcome", () => {
  it("does not call a skipped cycle a success", () => {
    const outcome = describeCycleOutcome("no_op", "drafts_waiting_for_review")!;
    expect(outcome.label).toBe("Ran, nothing new created");
    expect(outcome.tone).toBe("warning");
    expect(outcome.detail).toContain("drafts waiting");
  });
  it("describes created drafts and unknown decisions", () => {
    expect(describeCycleOutcome("create_review_draft", undefined)?.tone).toBe("success");
    expect(describeCycleOutcome("something_else", undefined)).toBeNull();
    expect(describeCycleOutcome("no_op", "unknown_reason")?.detail).toBe("No new post was created this time.");
  });
});
