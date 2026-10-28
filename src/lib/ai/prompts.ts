/**
 * Prompt composition for LinkedIn draft and plan generation.
 *
 * Implements Nunuza's content rules:
 * - Text-only posts (no markdown tables, no image markdown)
 * - Hard character limit: 3,000 characters (posts_text_max_length DB constraint)
 * - Structured formatting: compelling hook, clean line breaks, concise takeaways, subtle CTA
 * - Adherence to tone, voice preferences, and negative phrase constraints
 */

import type { DraftGenerationRequest, PlanGenerationRequest } from "./types";

export function buildDraftPrompt(request: DraftGenerationRequest): {
  systemPrompt: string;
  userPrompt: string;
} {
  const { topic, pillar, notes, targetLength = "medium", voiceProfile, strategy, userRole, companyName } = request;

  let lengthGuideline = "Aim for roughly 900 to 1,400 characters (around 150-250 words).";
  if (targetLength === "short") {
    lengthGuideline = "Aim for roughly 400 to 700 characters (around 70-120 words). Direct and punchy.";
  } else if (targetLength === "long") {
    lengthGuideline = "Aim for roughly 1,600 to 2,400 characters (around 250-400 words). Detailed breakdown with structure.";
  }

  const systemLines: string[] = [
    "You are Nunuza, an elite LinkedIn content operations assistant for solo founders and small business operators.",
    "Your objective is to craft authentic, compelling, high-signal LinkedIn posts that build authority and attract qualified conversations.",
    "",
    "CRITICAL FORMATTING & POLICY RULES:",
    "1. HARD LIMIT: The output MUST NEVER exceed 3,000 characters.",
    "2. Organic personal text only. Do NOT output image placeholders, hashtags overload (max 3 relevant hashtags, or none), or cheesy engagement-bait (e.g., 'Agree? Thoughts?').",
    "3. Use clean single and double line breaks. Make it easily scannable on mobile screens.",
    "4. Strong opening hook: the first 2 lines must stop the scroll before the 'see more' cutoff.",
    "5. Sound like an experienced practitioner sharing real lessons, not a marketing copywriter.",
  ];

  if (userRole || companyName) {
    systemLines.push(`Author context: ${userRole ?? "Founder"} ${companyName ? `at ${companyName}` : ""}`);
  }

  if (voiceProfile) {
    systemLines.push("");
    systemLines.push("VOICE PROFILE RULES:");
    if (voiceProfile.tone) systemLines.push(`- Tone: ${voiceProfile.tone}`);
    if (voiceProfile.sentenceLength) systemLines.push(`- Sentence style: ${voiceProfile.sentenceLength}`);
    if (voiceProfile.formality) systemLines.push(`- Formality: ${voiceProfile.formality}`);
    if (voiceProfile.phrasesUse && voiceProfile.phrasesUse.length > 0) {
      systemLines.push(`- Favorite phrases / themes to embrace: ${voiceProfile.phrasesUse.join(", ")}`);
    }
    if (voiceProfile.phrasesAvoid && voiceProfile.phrasesAvoid.length > 0) {
      systemLines.push(`- FORBIDDEN PHRASES (NEVER USE): ${voiceProfile.phrasesAvoid.join(", ")}`);
    }
    if (voiceProfile.exclusions && voiceProfile.exclusions.length > 0) {
      systemLines.push(`- Topics/themes to avoid completely: ${voiceProfile.exclusions.join(", ")}`);
    }
    if (voiceProfile.sampleText) {
      systemLines.push(`- Stylistic sample to emulate: \"${voiceProfile.sampleText.slice(0, 400)}\"`);
    }
  }

  if (strategy) {
    systemLines.push("");
    systemLines.push("AUDIENCE & STRATEGY CONTEXT:");
    if (strategy.audience) {
      systemLines.push(`- Target Audience: ${JSON.stringify(strategy.audience)}`);
    }
    if (strategy.goals && strategy.goals.length > 0) {
      systemLines.push(`- Business Goals: ${strategy.goals.join(", ")}`);
    }
    if (strategy.ctaPreferences && strategy.ctaPreferences.length > 0) {
      systemLines.push(`- Preferred CTA style: ${strategy.ctaPreferences.join(", ")}`);
    }
  }

  const userLines: string[] = [
    `Topic: ${topic}`,
    pillar ? `Content Pillar: ${pillar}` : "",
    notes ? `Source notes / thoughts: ${notes}` : "",
    lengthGuideline,
    "",
    "Write the complete LinkedIn post directly. Do not include markdown code fences or conversational intros like 'Here is your post:'."
  ].filter(Boolean);

  return {
    systemPrompt: systemLines.join("\n"),
    userPrompt: userLines.join("\n"),
  };
}

export function buildPlanPrompt(request: PlanGenerationRequest): {
  systemPrompt: string;
  userPrompt: string;
} {
  const { periodStart, periodDays, cadencePerWeek, preferredDays = [], strategy, userRole } = request;

  const systemPrompt = [
    "You are Nunuza's strategic content planner for solo founders.",
    "Your task is to generate a structured content calendar containing post concepts mapped across the planned period.",
    "Output MUST be valid JSON conforming to the requested schema. Do not output markdown code blocks or explanatory text.",
  ].join("\n");

  const pillarsList = strategy.pillars && strategy.pillars.length > 0
    ? strategy.pillars.join(", ")
    : "Founding journey, Practical lessons, Industry perspective, Systems & processes";

  const userPrompt = [
    `Plan start date: ${periodStart}`,
    `Duration: ${periodDays} days`,
    `Cadence: ${cadencePerWeek} posts per week`,
    preferredDays.length > 0 ? `Preferred posting days (0=Sun, 6=Sat): ${preferredDays.join(", ")}` : "",
    `Author role: ${userRole ?? "Founder"}`,
    `Content pillars: ${pillarsList}`,
    strategy.audience ? `Target audience: ${JSON.stringify(strategy.audience)}` : "",
    "",
    "Generate a balanced plan. Output JSON matching this exact structure:",
    JSON.stringify({
      summary: "Brief 1-sentence strategic focus for this period",
      topics: [
        {
          dayOffset: 0,
          date: periodStart,
          pillar: "Founding journey",
          title: "Internal topic title",
          angle: "Specific angle or premise for the post",
          targetFormat: "lesson"
        }
      ]
    }, null, 2)
  ].filter(Boolean).join("\n");

  return { systemPrompt, userPrompt };
}
