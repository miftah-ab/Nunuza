/**
 * OpenRouter AI Provider (Fallback).
 *
 * Default model: anthropic/claude-3-haiku
 * Endpoint: https://openrouter.ai/api/v1/chat/completions
 *
 * Server-side only; never exposes OPENROUTER_API_KEY to the browser.
 */

import type {
  AiProvider,
  DraftGenerationRequest,
  DraftGenerationResult,
  PlanGenerationRequest,
  PlanGenerationResult,
} from "./types";
import { buildDraftPrompt, buildPlanPrompt } from "./prompts";

export class OpenRouterProvider implements AiProvider {
  readonly id = "openrouter" as const;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(apiKey?: string, model?: string, timeoutMs = 20000) {
    this.apiKey = apiKey ?? process.env.OPENROUTER_API_KEY ?? "";
    this.model = model ?? process.env.OPENROUTER_DEFAULT_MODEL ?? "anthropic/claude-3-haiku";
    this.timeoutMs = timeoutMs;
  }

  isConfigured(): boolean {
    return Boolean(
      this.apiKey &&
      this.apiKey.trim().length > 0 &&
      !this.apiKey.includes("your-openrouter")
    );
  }

  async generateDraft(request: DraftGenerationRequest): Promise<DraftGenerationResult> {
    if (!this.isConfigured()) {
      throw new Error("OPENROUTER_API_KEY is not configured or placeholder.");
    }

    const { systemPrompt, userPrompt } = buildDraftPrompt(request);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://nunuza.com",
          "X-Title": "Nunuza LinkedIn Assistant",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: 1200,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API returned HTTP ${response.status}: ${errorText.slice(0, 200)}`);
      }

      const json = (await response.json()) as any;
      const content = json.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error("OpenRouter API returned empty completion.");
      }

      const safeText = content.slice(0, 3000);

      return {
        text: safeText,
        internalTitle: request.topic.length > 50 ? `${request.topic.slice(0, 47)}...` : request.topic,
        pillar: request.pillar,
        providerUsed: "openrouter",
        modelUsed: this.model,
        estimatedTokens: json.usage?.total_tokens ?? Math.round(safeText.length / 4),
        generatedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async generatePlan(request: PlanGenerationRequest): Promise<PlanGenerationResult> {
    if (!this.isConfigured()) {
      throw new Error("OPENROUTER_API_KEY is not configured or placeholder.");
    }

    const { systemPrompt, userPrompt } = buildPlanPrompt(request);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://nunuza.com",
          "X-Title": "Nunuza LinkedIn Assistant",
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.5,
          response_format: { type: "json_object" },
          max_tokens: 1800,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API returned HTTP ${response.status}: ${errorText.slice(0, 200)}`);
      }

      const json = (await response.json()) as any;
      const rawJson = json.choices?.[0]?.message?.content?.trim();
      const parsed = JSON.parse(rawJson);

      return {
        topics: Array.isArray(parsed.topics) ? parsed.topics : [],
        summary: parsed.summary ?? "Generated content plan.",
        providerUsed: "openrouter",
        modelUsed: this.model,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
