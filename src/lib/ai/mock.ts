/**
 * Deterministic Mock AI Provider.
 *
 * Used in local development when API keys are not supplied,
 * in automated unit/integration tests, and in CI environments.
 *
 * Explicitly marks `providerUsed: "mock_deterministic"` so mock output
 * is NEVER presented as real AI generation (BED-04 / Phase 3 spec).
 */

import type {
  AiProvider,
  DraftGenerationRequest,
  DraftGenerationResult,
  PlanGenerationRequest,
  PlanGenerationResult,
  PlanTopicIdea,
} from "./types";

export class MockAiProvider implements AiProvider {
  readonly id = "mock_deterministic" as const;

  async generateDraft(request: DraftGenerationRequest): Promise<DraftGenerationResult> {
    const { topic, pillar = "Lessons Learned", userRole = "Founder", notes } = request;

    // Build structured, realistic LinkedIn post content
    const hook = `Most people think ${topic} is about working harder. They're wrong.`;
    const context = `When building as a ${userRole}, you quickly learn that energy without leverage is just expensive motion.`;
    const coreTakeaway = notes
      ? `Here is what I've observed firsthand: ${notes}`
      : `Here are 3 concrete principles I follow instead:\n\n1. Protect focused execution blocks.\n2. Build workflows you can sustain when motivation drops.\n3. Validate with real users before adding complexity.`;
    const cta = "What is the biggest operational lesson you've had to learn the hard way?";

    const fullText = [hook, "", context, "", coreTakeaway, "", cta].join("\n");

    // Strictly enforce <= 3000 chars
    const safeText = fullText.slice(0, 3000);

    return {
      text: safeText,
      internalTitle: topic.length > 50 ? `${topic.slice(0, 47)}...` : topic,
      pillar,
      providerUsed: "mock_deterministic",
      modelUsed: "mock-deterministic-v1",
      estimatedTokens: Math.round(safeText.length / 4),
      generatedAt: new Date().toISOString(),
    };
  }

  async generatePlan(request: PlanGenerationRequest): Promise<PlanGenerationResult> {
    const { periodStart, periodDays, cadencePerWeek, strategy } = request;

    const pillars = (strategy.pillars && strategy.pillars.length > 0)
      ? strategy.pillars
      : ["Founding Journey", "Operational Lessons", "Systems & Tools"];

    const totalPosts = Math.min(
      Math.max(1, Math.round((cadencePerWeek / 7) * periodDays)),
      7 // hard cap: max 7 posts per rolling 7 days (BED-02)
    );

    const startDate = new Date(periodStart);
    const topics: PlanTopicIdea[] = [];

    const formats: Array<"story" | "breakdown" | "observation" | "lesson"> = [
      "lesson",
      "breakdown",
      "observation",
      "story",
    ];

    for (let i = 0; i < totalPosts; i++) {
      const step = Math.floor(periodDays / totalPosts);
      const dayOffset = Math.min(i * step, periodDays - 1);
      const postDate = new Date(startDate);
      postDate.setDate(postDate.getDate() + dayOffset);

      const pillar = pillars[i % pillars.length];
      const targetFormat = formats[i % formats.length];

      topics.push({
        dayOffset,
        date: postDate.toISOString().split("T")[0],
        pillar,
        title: `${pillar}: Key takeaway #${i + 1}`,
        angle: `Practical breakdown of how we handle ${pillar.toLowerCase()} in production.`,
        targetFormat,
      });
    }

    return {
      topics,
      summary: `Targeting ${totalPosts} high-signal posts across ${periodDays} days focusing on ${pillars.join(", ")}.`,
      providerUsed: "mock_deterministic",
      modelUsed: "mock-deterministic-v1",
    };
  }
}
