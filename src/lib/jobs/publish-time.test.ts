import { describe, expect, it } from "vitest";
import { nextPublishTime } from "./publish-time";

describe("nextPublishTime", () => {
  it("uses today's preferred time when it is still ahead", () => {
    const now = new Date("2026-11-16T06:00:00Z"); // Monday
    expect(nextPublishTime(now, { preferredTime: "09:00", timezone: "UTC" }).toISOString()).toBe("2026-11-16T09:00:00.000Z");
  });

  it("rolls to the next day when the time has passed", () => {
    const now = new Date("2026-11-16T10:00:00Z");
    expect(nextPublishTime(now, { preferredTime: "09:00", timezone: "UTC" }).toISOString()).toBe("2026-11-17T09:00:00.000Z");
  });

  it("honours the minimum lead time (veto window)", () => {
    const now = new Date("2026-11-16T08:50:00Z");
    expect(nextPublishTime(now, { preferredTime: "09:00", timezone: "UTC" }, 30 * 60_000).toISOString()).toBe("2026-11-17T09:00:00.000Z");
  });

  it("skips non-preferred days (0 = Sunday)", () => {
    const now = new Date("2026-11-14T12:00:00Z"); // Saturday
    expect(nextPublishTime(now, { preferredTime: "09:00", preferredDays: [1, 2], timezone: "UTC" }).toISOString()).toBe("2026-11-16T09:00:00.000Z");
  });

  it("converts from the workspace timezone", () => {
    const now = new Date("2026-11-16T00:00:00Z");
    // 09:00 in Addis Ababa (UTC+3) is 06:00 UTC
    expect(nextPublishTime(now, { preferredTime: "09:00", timezone: "Africa/Addis_Ababa" }).toISOString()).toBe("2026-11-16T06:00:00.000Z");
  });

  it("handles daylight saving offsets", () => {
    const now = new Date("2026-07-01T00:00:00Z");
    expect(nextPublishTime(now, { preferredTime: "09:00", timezone: "America/New_York" }).toISOString()).toBe("2026-07-01T13:00:00.000Z");
    const winter = new Date("2026-12-01T00:00:00Z");
    expect(nextPublishTime(winter, { preferredTime: "09:00", timezone: "America/New_York" }).toISOString()).toBe("2026-12-01T14:00:00.000Z");
  });

  it("falls back to 09:00 UTC for a missing time and bad timezone", () => {
    const now = new Date("2026-11-16T00:00:00Z");
    expect(nextPublishTime(now, { preferredTime: null, timezone: "Not/AZone" }).toISOString()).toBe("2026-11-16T09:00:00.000Z");
  });
});
