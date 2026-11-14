import { describe, expect, it } from "vitest";
import {
  buildCycleNotificationMessage,
  buildLearningProfile,
  isAutonomousEntitlementEligible,
  isAutonomousWorkspaceActive,
  isDuplicateOpportunity,
  isValidCycleDate,
  matchesStrategyExclusion,
  parseResearchFeed,
  scoreOpportunity,
  type ResearchItem,
} from "./intelligence";

const NOW = Date.parse("2026-11-10T12:00:00.000Z");

describe("autonomous cycle payload validation", () => {
  it("accepts real UTC calendar dates and rejects malformed or impossible dates", () => {
    expect(isValidCycleDate("2026-11-10")).toBe(true);
    expect(isValidCycleDate("2026-02-30")).toBe(false);
    expect(isValidCycleDate("10-11-2026")).toBe(false);
    expect(isValidCycleDate(20261110)).toBe(false);
  });
});

describe("intelligence cycle notifications", () => {
  it("reports the product action without forwarding research headlines or article links", () => {
    const approvalMessage = buildCycleNotificationMessage("approval_required");
    const autopilotMessage = buildCycleNotificationMessage("autopilot");

    expect(approvalMessage).toContain("draft is ready for your review");
    expect(approvalMessage).toContain("/drafts");
    expect(autopilotMessage).toContain("queued a LinkedIn post");
    expect(autopilotMessage).toContain("/drafts");

    for (const message of [approvalMessage, autopilotMessage]) {
      expect(message).not.toContain("http");
      expect(message).not.toContain("Reuters");
      expect(message).not.toContain("opportunity");
    }
  });
});

describe("autonomous intelligence primitives", () => {
  it("allows only current beta and paid entitlements to run autonomous cycles", () => {
    expect(isAutonomousEntitlementEligible("internal_beta")).toBe(true);
    expect(isAutonomousEntitlementEligible("paid_trial")).toBe(true);
    expect(isAutonomousEntitlementEligible("paid_active")).toBe(true);
    expect(isAutonomousEntitlementEligible("publishing_beta")).toBe(false);
    expect(isAutonomousEntitlementEligible("internal_test")).toBe(false);
    expect(isAutonomousEntitlementEligible("draft_only")).toBe(false);
    expect(isAutonomousEntitlementEligible("suspended")).toBe(false);
  });

  it("requires an active, unpaused workspace before a cycle can act", () => {
    expect(isAutonomousWorkspaceActive({ state: "active_approval_required" })).toBe(true);
    expect(isAutonomousWorkspaceActive({ state: "active_autopilot", paused_at: null })).toBe(true);
    expect(isAutonomousWorkspaceActive({ state: "paused" })).toBe(false);
    expect(isAutonomousWorkspaceActive({ state: "active_autopilot", paused_at: "2026-11-10T00:00:00Z" })).toBe(false);
  });

  it("extracts publisher URL, evidence, and timestamps from a fresh RSS item", () => {
    const xml = `<rss><channel><item>
      <title>New small business lending rules announced</title>
      <link>https://news.google.com/rss/articles/example</link>
      <pubDate>Tue, 10 Nov 2026 11:00:00 GMT</pubDate>
      <description><![CDATA[Regulators announced new lending rules affecting small business owners.]]></description>
      <source url="https://www.reuters.com">Reuters</source>
    </item></channel></rss>`;
    const items = parseResearchFeed(xml, NOW);
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("Reuters");
    expect(items[0].sourceUrl).toBe("https://www.reuters.com/");
    expect(items[0].evidence).toContain("lending rules");
    expect(items[0].retrievedAt).toBe("2026-11-10T12:00:00.000Z");
  });

  it("rejects stale, insecure, and evidence-free research items", () => {
    const stale = `<item><title>Old business news</title><link>https://news.google.com/a</link>
      <pubDate>Tue, 01 Sep 2026 11:00:00 GMT</pubDate><description>Old article summary long enough to pass length.</description>
      <source url="https://example.com">Example</source></item>`;
    const insecure = `<item><title>Unsafe news</title><link>http://news.google.com/a</link>
      <pubDate>Tue, 10 Nov 2026 11:00:00 GMT</pubDate><description>Article summary long enough to pass length.</description>
      <source url="https://example.com">Example</source></item>`;
    const noEvidence = `<item><title>No evidence</title><link>https://news.google.com/a</link>
      <pubDate>Tue, 10 Nov 2026 11:00:00 GMT</pubDate><description>Short</description>
      <source url="https://example.com">Example</source></item>`;
    expect(parseResearchFeed(stale, NOW)).toHaveLength(0);
    expect(parseResearchFeed(insecure, NOW)).toHaveLength(0);
    expect(parseResearchFeed(noEvidence, NOW)).toHaveLength(0);
  });

  it("learns approved and rejected topic terms without mixing user edits with outcomes", () => {
    const profile = buildLearningProfile(
      [
        { id: "a", internal_title: "Small business cash flow", pillar: "Finance", text: "Business growth needs a simple practical checklist." },
        { id: "b", internal_title: "Crypto trading trends", pillar: "Speculation", text: "A business growth approach uses a simple practical checklist." },
      ],
      [
        { post_id: "a", action: "approved" },
        { post_id: "b", action: "rejected" },
      ],
      [
        { post_id: "a", change_source: "ai_generation", version_number: 1, text: "Business growth needs a complex framework." },
        { post_id: "a", change_source: "user_edit", version_number: 2, text: "Business growth needs a simple practical checklist." },
        { post_id: "b", change_source: "ai_generation", version_number: 1, text: "A business growth approach uses a complex framework." },
        { post_id: "b", change_source: "user_edit", version_number: 2, text: "A business growth approach uses a simple practical checklist." },
      ],
    );
    expect(profile.approvedTerms).toContain("business");
    expect(profile.rejectedTerms).toContain("crypto");
    expect(profile.approvedCount).toBe(1);
    expect(profile.rejectedCount).toBe(1);
    expect(profile.editCount).toBe(2);
    expect(profile.preferredEditTerms).toContain("practical");
    expect(profile.avoidedEditTerms).toContain("complex");
  });

  it("ranks approved-topic matches higher and rejected-topic matches lower", () => {
    const item = {
      title: "Small business finance trends",
      url: "https://news.google.com/example",
      sourceUrl: "https://example.com/",
      source: "Example",
      evidence: "A detailed source excerpt about small business finance.",
      publishedAt: new Date(NOW - 3600000).toISOString(),
      retrievedAt: new Date(NOW).toISOString(),
    } satisfies ResearchItem;
    const baseline = scoreOpportunity(item, ["small business finance"], NOW);
    const learned = scoreOpportunity(item, ["small business finance"], NOW, {
      approvedTerms: ["business", "finance"],
      rejectedTerms: [],
      approvedCount: 2,
      rejectedCount: 0,
      preferredEditTerms: [],
      avoidedEditTerms: [],
      editCount: 0,
    });
    const rejected = scoreOpportunity(item, ["small business finance"], NOW, {
      approvedTerms: [],
      rejectedTerms: ["business", "finance"],
      approvedCount: 0,
      rejectedCount: 2,
      preferredEditTerms: [],
      avoidedEditTerms: [],
      editCount: 0,
    });
    expect(learned.score).toBeGreaterThan(baseline.score);
    expect(rejected.score).toBeLessThan(baseline.score);
  });

  it("matches strategy and learned preferences in publisher evidence, not only headlines", () => {
    const item = {
      title: "Industry update",
      url: "https://news.google.com/example",
      sourceUrl: "https://example.com/",
      source: "Example",
      evidence: "Small business owners are facing rising customer acquisition costs and cash flow pressure.",
      publishedAt: new Date(NOW - 3600000).toISOString(),
      retrievedAt: new Date(NOW).toISOString(),
    } satisfies ResearchItem;
    const scored = scoreOpportunity(item, ["small business"], NOW, {
      approvedTerms: ["cash", "flow"],
      rejectedTerms: [],
      preferredEditTerms: [],
      avoidedEditTerms: [],
      approvedCount: 1,
      rejectedCount: 0,
      editCount: 0,
    });
    expect(scored.matchedKeywords).toContain("small");
    expect(scored.matchedKeywords).toContain("business");
    expect(scored.scoreBreakdown.approvalPreference).toBeGreaterThan(0);
  });

  it("scores evidence quality and potential value and rejects excluded brand topics", () => {
    const item = {
      title: "Small business security risks and cost savings",
      url: "https://news.google.com/example",
      sourceUrl: "https://example.com/",
      source: "Example",
      evidence: "A detailed report on security risks and practical cost savings for small business owners.",
      publishedAt: new Date(NOW - 3600000).toISOString(),
      retrievedAt: new Date(NOW).toISOString(),
    } satisfies ResearchItem;
    const scored = scoreOpportunity(item, ["small business"], NOW);
    expect(scored.scoreBreakdown.evidenceQuality).toBeGreaterThan(0);
    expect(scored.scoreBreakdown.potentialValue).toBeGreaterThan(0);
    expect(matchesStrategyExclusion(item, ["security risks"])).toBe(true);
    expect(matchesStrategyExclusion(item, ["cryptocurrency trading"])).toBe(false);
  });

  it("detects substantially repeated opportunity titles", () => {
    expect(isDuplicateOpportunity("Small business cash flow planning", ["Cash flow planning for small business owners"])).toBe(true);
    expect(isDuplicateOpportunity("Hiring trends in healthcare", ["Cash flow planning for small business owners"])).toBe(false);
  });
});
