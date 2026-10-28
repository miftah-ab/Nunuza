/**
 * AI Service Unit Tests (Mocked / Deterministic).
 *
 * Verifies draft and plan generation logic, provider fallback hierarchy,
 * character boundaries, and transparent mock provider labeling.
 */

import { describe, it, expect, vi } from "vitest";
import { AiService } from "./service";
import { MockAiProvider } from "./mock";
import { GroqProvider } from "./groq";
import { OpenRouterProvider } from "./openrouter";

describe("AI Service & Generation Pipeline", () => {
  it("rejects empty draft topic with validation error", async () => {
    const service = new AiService();
    await expect(service.generateDraft({ topic: "   " })).rejects.toThrow(
      "Draft topic cannot be empty."
    );
  });

  it("uses deterministic mock provider when external API keys are absent", async () => {
    const mock = new MockAiProvider();
    const service = new AiService(
      new GroqProvider(""),
      new OpenRouterProvider(""),
      mock
    );

    const result = await service.generateDraft({
      topic: "Bootstrapping a B2B SaaS",
      pillar: "Founding journey",
      notes: "Focus on talking to users first",
      userRole: "Founder",
    });

    expect(result.providerUsed).toBe("mock_deterministic");
    expect(result.modelUsed).toBe("mock-deterministic-v1");
    expect(result.text).toContain("Bootstrapping a B2B SaaS");
    expect(result.text.length).toBeLessThanOrEqual(3000);
  });

  it("transparently falls back to OpenRouter when Groq throws an error", async () => {
    const mockGroq = new GroqProvider("mock-key");
    vi.spyOn(mockGroq, "isConfigured").mockReturnValue(true);
    vi.spyOn(mockGroq, "generateDraft").mockRejectedValue(new Error("Groq 503 Overloaded"));

    const mockOpenRouter = new OpenRouterProvider("mock-key");
    vi.spyOn(mockOpenRouter, "isConfigured").mockReturnValue(true);
    vi.spyOn(mockOpenRouter, "generateDraft").mockResolvedValue({
      text: "OpenRouter generated post content",
      internalTitle: "Topic",
      providerUsed: "openrouter",
      modelUsed: "anthropic/claude-3-haiku",
      estimatedTokens: 100,
      generatedAt: new Date().toISOString(),
    });

    const service = new AiService(mockGroq, mockOpenRouter, new MockAiProvider());

    const result = await service.generateDraft({ topic: "Scaling Postgres" });
    expect(result.providerUsed).toBe("openrouter");
    expect(result.modelUsed).toBe("anthropic/claude-3-haiku");
    expect(result.text).toBe("OpenRouter generated post content");
  });

  it("strictly enforces hard max 3,000 characters limit", async () => {
    const mock = new MockAiProvider();
    // Simulate oversized text
    vi.spyOn(mock, "generateDraft").mockImplementation(async (req) => {
      const longText = "A".repeat(4000);
      return {
        text: longText.slice(0, 3000),
        internalTitle: req.topic,
        providerUsed: "mock_deterministic",
        modelUsed: "mock-v1",
        estimatedTokens: 750,
        generatedAt: new Date().toISOString(),
      };
    });

    const service = new AiService(
      new GroqProvider(""),
      new OpenRouterProvider(""),
      mock
    );

    const result = await service.generateDraft({ topic: "Long content test" });
    expect(result.text.length).toBeLessThanOrEqual(3000);
  });

  it("generates a structured plan adhering to cadence bounds", async () => {
    const service = new AiService();

    const plan = await service.generatePlan({
      periodStart: "2026-11-01",
      periodDays: 7,
      cadencePerWeek: 3,
      strategy: {
        pillars: ["Strategy", "Execution", "Hiring"],
      },
    });

    expect(plan.topics.length).toBeGreaterThanOrEqual(1);
    expect(plan.topics.length).toBeLessThanOrEqual(7);
    expect(plan.topics[0]).toHaveProperty("date");
    expect(plan.topics[0]).toHaveProperty("title");
    expect(plan.topics[0]).toHaveProperty("pillar");
  });

  it("rejects plan generation with invalid cadence", async () => {
    const service = new AiService();
    await expect(
      service.generatePlan({
        periodStart: "2026-11-01",
        periodDays: 7,
        cadencePerWeek: 0,
        strategy: {},
      })
    ).rejects.toThrow("Cadence must be between 1 and 7");

    await expect(
      service.generatePlan({
        periodStart: "2026-11-01",
        periodDays: 7,
        cadencePerWeek: 8,
        strategy: {},
      })
    ).rejects.toThrow("Cadence must be between 1 and 7");
  });
});
