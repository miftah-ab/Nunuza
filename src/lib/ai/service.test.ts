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

  it("strips Markdown markers from provider output before returning a draft", async () => {
    const mock = new MockAiProvider();
    vi.spyOn(mock, "generateDraft").mockResolvedValue({
      text: "**A strong hook**\n\nThis is **important** and *clear*.\n\n**",
      internalTitle: "Topic",
      providerUsed: "mock_deterministic",
      modelUsed: "mock-v1",
      estimatedTokens: 20,
      generatedAt: new Date().toISOString(),
    });

    const service = new AiService(
      new GroqProvider(""),
      new OpenRouterProvider(""),
      mock
    );
    const result = await service.generateDraft({ topic: "Formatting test" });

    expect(result.text).toBe("A strong hook\n\nThis is important and clear.");
    expect(result.text).not.toContain("**");
  });

  it("rejects oversized generated text instead of silently cutting it off", async () => {
    const mock = new MockAiProvider();
    vi.spyOn(mock, "generateDraft").mockImplementation(async (req) => ({
      text: "A".repeat(4000),
      internalTitle: req.topic,
      providerUsed: "mock_deterministic",
      modelUsed: "mock-v1",
      estimatedTokens: 1000,
      generatedAt: new Date().toISOString(),
    }));

    const service = new AiService(
      new GroqProvider(""),
      new OpenRouterProvider(""),
      mock
    );

    await expect(service.generateDraft({ topic: "Long content test" }))
      .rejects.toThrow("AI_POST_TOO_LONG");
  });

  it("does not replace a known incomplete AI response with a mock draft", async () => {
    const groq = new GroqProvider("mock-key");
    vi.spyOn(groq, "isConfigured").mockReturnValue(true);
    vi.spyOn(groq, "generateDraft").mockRejectedValue(
      new Error("AI_INCOMPLETE_OUTPUT: Provider reached its output-token limit.")
    );

    const mock = new MockAiProvider();
    const mockGenerate = vi.spyOn(mock, "generateDraft");

    const service = new AiService(groq, new OpenRouterProvider(""), mock);
    await expect(service.generateDraft({ topic: "A long post" }))
      .rejects.toThrow("AI_INCOMPLETE_OUTPUT");
    expect(mockGenerate).not.toHaveBeenCalled();
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
