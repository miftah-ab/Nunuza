import { describe, expect, it, vi } from "vitest";
import { buildEvergreenOpportunity, buildWidenedResearchQuery } from "./intelligence";
import { scheduleApprovedPost, cancelScheduledPostByAgent, formatScheduledTime } from "./agent-scheduling";

const strategy = { pillars: [{ name: "Supply chain resilience" }, "Founder lessons"], goals: ["Win logistics clients"], audience: {} };

describe("research widening and evergreen fallback", () => {
  it("builds a phrase query from pillars and goals", () => {
    const query = buildWidenedResearchQuery(strategy);
    expect(query).toContain('"Supply chain resilience"');
    expect(query).toContain(" OR ");
  });

  it("rotates evergreen pillars and skips recent titles", () => {
    const first = buildEvergreenOpportunity(strategy, [], "2026-11-16")!;
    const second = buildEvergreenOpportunity(strategy, [first.title], "2026-11-16")!;
    expect(first.url).toBe("");
    expect(second.title).not.toBe(first.title);
    expect(buildEvergreenOpportunity({ pillars: [] }, [], "2026-11-16")).toBeNull();
  });
});

function fakeSupabase(rpc: Record<string, any>, strategyRow: any = { preferred_time: "09:00", preferred_days: null, timezone: "UTC" }) {
  const updates: any[] = [];
  const client: any = {
    rpc: vi.fn(async (name: string) => ({ data: rpc[name], error: null })),
    from: vi.fn((table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === "content_strategies" ? strategyRow : null }) }) }),
      update: (patch: any) => ({ eq: () => ({ eq: async () => { updates.push(patch); return { error: null }; } }) }),
    })),
  };
  return { client, updates };
}

describe("agent scheduling", () => {
  it("schedules at the preferred slot and marks the job as autopilot", async () => {
    const { client, updates } = fakeSupabase({ schedule_post_atomic: { success: true, job: { id: "j1", payload: { postId: "p1" } } } });
    const result = await scheduleApprovedPost(client, {
      workspaceId: "w", ownerUserId: "u", postId: "p1", minLeadMs: 15 * 60_000, autopilot: true,
      now: new Date("2026-11-16T10:00:00Z"),
    });
    expect(result).toMatchObject({ ok: true, scheduledFor: "2026-11-17T09:00:00.000Z" });
    expect(updates[0].payload).toEqual({ postId: "p1", autopilot: true });
  });

  it("reports why scheduling was refused", async () => {
    const { client } = fakeSupabase({ schedule_post_atomic: { success: false, reason: "DAILY_CAP_REACHED" } });
    const result = await scheduleApprovedPost(client, { workspaceId: "w", ownerUserId: "u", postId: "p", minLeadMs: 0, autopilot: false });
    expect(result).toEqual({ ok: false, reason: "DAILY_CAP_REACHED" });
  });

  it("cancel returns the database reason when too late", async () => {
    const { client } = fakeSupabase({ cancel_scheduled_post_atomic: [{ success: false, reason: "JOB_NOT_CANCELLABLE" }] });
    expect(await cancelScheduledPostByAgent(client, "w", "p")).toEqual({ ok: false, reason: "JOB_NOT_CANCELLABLE" });
  });

  it("formats the time in the workspace timezone", () => {
    expect(formatScheduledTime("2026-11-17T09:00:00.000Z", "Africa/Addis_Ababa")).toContain("12:00");
  });
});
