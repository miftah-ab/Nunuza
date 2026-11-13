import { describe, expect, it } from "vitest";
import { getHourlyImageLimit, hasReachedHourlyImageLimit } from "./image-limits";

describe("image generation limits", () => {
  it("allows 100 images per hour for private beta workspaces", () => {
    expect(getHourlyImageLimit("internal_beta")).toBe(100);
    expect(hasReachedHourlyImageLimit(100, getHourlyImageLimit("internal_beta"))).toBe(false);
    expect(hasReachedHourlyImageLimit(101, getHourlyImageLimit("internal_beta"))).toBe(true);
  });

  it("keeps standard and paid workspaces at the standard hourly limit", () => {
    expect(getHourlyImageLimit("draft_only")).toBe(5);
    expect(getHourlyImageLimit("paid_trial")).toBe(5);
    expect(getHourlyImageLimit("paid_active")).toBe(5);
    expect(hasReachedHourlyImageLimit(6, getHourlyImageLimit("paid_active"))).toBe(true);
  });
});
