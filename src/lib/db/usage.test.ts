/**
 * Usage limit unit tests — pure logic only, no DB connection required.
 *
 * Tests the getCalendarMonthPeriod() function and the
 * DraftLimitStatus shape logic that can be verified without Supabase.
 *
 * checkDraftLimit() and incrementDraftCounter() are integration tests
 * that require a real Supabase project — they are NOT VERIFIED here.
 */

import { describe, it, expect } from "vitest";
import { getCalendarMonthPeriod, MONTHLY_DRAFT_LIMIT } from "@/lib/db/usage";

describe("getCalendarMonthPeriod()", () => {
  it("returns the first day of the month as periodStart", () => {
    const date = new Date("2026-10-15T12:00:00Z");
    const { periodStart } = getCalendarMonthPeriod(date);
    expect(periodStart).toBe("2026-10-01");
  });

  it("returns the last day of the month as periodEnd", () => {
    const date = new Date("2026-10-15T12:00:00Z");
    const { periodEnd } = getCalendarMonthPeriod(date);
    expect(periodEnd).toBe("2026-10-31");
  });

  it("handles February correctly in a non-leap year", () => {
    const date = new Date("2026-02-10T00:00:00Z");
    const { periodStart, periodEnd } = getCalendarMonthPeriod(date);
    expect(periodStart).toBe("2026-02-01");
    expect(periodEnd).toBe("2026-02-28");
  });

  it("handles February correctly in a leap year", () => {
    const date = new Date("2028-02-10T00:00:00Z");
    const { periodEnd } = getCalendarMonthPeriod(date);
    expect(periodEnd).toBe("2028-02-29");
  });

  it("handles December month rollover correctly", () => {
    const date = new Date("2026-12-01T00:00:00Z");
    const { periodStart, periodEnd } = getCalendarMonthPeriod(date);
    expect(periodStart).toBe("2026-12-01");
    expect(periodEnd).toBe("2026-12-31");
  });

  it("periodStart and periodEnd are valid ISO date strings", () => {
    const { periodStart, periodEnd } = getCalendarMonthPeriod();
    expect(periodStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(periodEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("periodEnd is always >= periodStart", () => {
    const { periodStart, periodEnd } = getCalendarMonthPeriod();
    expect(periodEnd >= periodStart).toBe(true);
  });
});

describe("MONTHLY_DRAFT_LIMIT", () => {
  it("is exactly 30 (spec §12)", () => {
    expect(MONTHLY_DRAFT_LIMIT).toBe(30);
  });

  it("is a number, not a string", () => {
    expect(typeof MONTHLY_DRAFT_LIMIT).toBe("number");
  });
});
