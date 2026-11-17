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

import { parseBingFeed, fetchResearchFromProviders } from "./intelligence";

const NOW = Date.parse("2026-11-16T09:00:00Z");
const bingXml = `<rss><channel><item>
<title>Freight rates climb as ports clog</title>
<link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=1&amp;url=https%3a%2f%2fwww.example-news.com%2Ffreight-rates&amp;c=1</link>
<description>Container freight rates rose sharply this week as congestion at major ports continued to delay shipments.</description>
<pubDate>Mon, 16 Nov 2026 06:00:00 GMT</pubDate>
<News:Source>Example News</News:Source>
</item><item>
<title>Too old</title><link>http://www.bing.com/news/apiclick.aspx?url=https%3a%2f%2fold.example.com%2Fa</link>
<description>This description is long enough to pass the minimum length check easily.</description>
<pubDate>Mon, 01 Jun 2026 06:00:00 GMT</pubDate><News:Source>Old</News:Source></item></channel></rss>`;

describe("Bing news fallback", () => {
  it("extracts the real article URL and publisher", () => {
    const items = parseBingFeed(bingXml, NOW);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      url: "https://www.example-news.com/freight-rates", sourceUrl: "https://www.example-news.com/", source: "Example News",
    });
  });

  it("uses the next provider when one fails, and names all failures when none answer", async () => {
    const item = parseBingFeed(bingXml, NOW);
    const down = { name: "google", fetch: async () => { throw new Error("HTTP 429"); } };
    expect(await fetchResearchFromProviders("q", [down, { name: "bing", fetch: async () => item }])).toEqual(item);
    await expect(fetchResearchFromProviders("q", [down, { name: "bing", fetch: async () => { throw new Error("timed out"); } }]))
      .rejects.toThrow("google: HTTP 429; bing: timed out");
    expect(await fetchResearchFromProviders("q", [down, { name: "bing", fetch: async () => [] }])).toEqual([]);
  });
});

import { cycleCapacityBlock } from "./intelligence";

describe("cycle capacity", () => {
  const posts = (...statuses: string[]) => statuses.map((status) => ({ status }));
  it("does not count unreviewed drafts as posts made", () => {
    expect(cycleCapacityBlock({ recentPosts: posts("needs_review", "needs_review", "needs_review", "draft"), waitingDrafts: 2, cadencePerWeek: 3 })).toBeNull();
  });
  it("stops when the weekly cadence of real posts is met", () => {
    expect(cycleCapacityBlock({ recentPosts: posts("published", "scheduled", "approved"), waitingDrafts: 0, cadencePerWeek: 3 })).toBe("weekly_cadence_already_met");
  });
  it("pauses and says so when too many drafts wait", () => {
    expect(cycleCapacityBlock({ recentPosts: [], waitingDrafts: 3, cadencePerWeek: 3 })).toBe("drafts_waiting_for_review");
  });
});
