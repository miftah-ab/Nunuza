/**
 * Content Planning Unit Tests (Mocked).
 *
 * Verifies plan period constraints, strategy prerequisite requirements,
 * and quota enforcement when converting plan topics to drafts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateAndSavePlan, convertPlanItemToDraft } from "./service";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/db/workspace", () => ({
  getContentStrategy: vi.fn(),
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/db/usage", () => ({
  checkDraftLimit: vi.fn(),
  incrementDraftCounter: vi.fn(),
}));

vi.mock("@/lib/db/posts", () => ({
  createPost: vi.fn(),
}));

describe("Content Planning Service (Mocked)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects plan periods shorter than 7 days or longer than 30 days", async () => {
    await expect(
      generateAndSavePlan("ws-1", "user-1", { periodDays: 5 })
    ).rejects.toThrow("Plan period must be between 7 and 30 days.");

    await expect(
      generateAndSavePlan("ws-1", "user-1", { periodDays: 45 })
    ).rejects.toThrow("Plan period must be between 7 and 30 days.");
  });

  it("throws clear error if workspace has no content strategy configured", async () => {
    const { getContentStrategy } = await import("@/lib/db/workspace");
    vi.mocked(getContentStrategy).mockResolvedValue(null);

    await expect(
      generateAndSavePlan("ws-1", "user-1", { periodDays: 7 })
    ).rejects.toThrow("Content strategy not found");
  });

  it("blocks converting plan topic to draft if monthly quota is reached", async () => {
    const { checkDraftLimit } = await import("@/lib/db/usage");
    vi.mocked(checkDraftLimit).mockResolvedValue({
      count: 30,
      limit: 30,
      isAtLimit: true,
      resetsOn: "2026-11-01",
    });

    await expect(
      convertPlanItemToDraft("ws-1", "user-1", {
        planId: "plan-123",
        topic: "Topic that exceeds quota",
      })
    ).rejects.toThrow("Monthly limit reached");
  });
});
