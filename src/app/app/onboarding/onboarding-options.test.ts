import { describe, expect, it } from "vitest";
import { buildOnboardingPayload, cleanAnswer, suggestTopics } from "./onboarding-options";

describe("onboarding options", () => {
  it("suggests role-specific topics first, padded and capped at 8", () => {
    const topics = suggestTopics(["Recruiter or HR"]);
    expect(topics[0]).toBe("Hiring lessons");
    expect(topics.length).toBeLessThanOrEqual(8);
    expect(new Set(topics).size).toBe(topics.length);
    expect(suggestTopics([]).length).toBeGreaterThan(0);
  });

  it("cleans free text: control characters, whitespace and length", () => {
    expect(cleanAnswer("  hi\n\tthere\u0000 ")).toBe("hi there");
    expect(cleanAnswer("x".repeat(500)).length).toBe(80);
  });

  it("maps answers onto the API fields", () => {
    const payload = buildOnboardingPayload({
      displayName: " Sam ",
      roles: ["Founder or CEO"],
      goals: ["Get clients", "Hire talent"],
      audience: ["Founders"],
      topics: ["Founder stories", "Hiring and team culture"],
      tones: ["Direct and clear"],
      postsPerWeek: 3,
      timezone: "Europe/Istanbul",
    });
    expect(payload).toMatchObject({
      displayName: "Sam",
      role: "Founder or CEO",
      primaryGoal: "Get clients, Hire talent",
      audienceRoles: "Founders",
      pillars: "Founder stories\nHiring and team culture",
      tone: "Direct and clear",
      postsPerWeek: 3,
      timezone: "Europe/Istanbul",
    });
  });

  it("leaves skipped answers undefined", () => {
    const payload = buildOnboardingPayload({
      displayName: "", roles: [], goals: [], audience: [], topics: [], tones: [], postsPerWeek: 3, timezone: "UTC",
    });
    expect(payload.role).toBeUndefined();
    expect(payload.pillars).toBeUndefined();
    expect(payload.tone).toBeUndefined();
  });
});
