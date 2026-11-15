/**
 * Groq AI Provider (Primary).
 *
 * Implements dynamic model discovery and selection based on the models
 * available to the configured API key, with graceful fallbacks.
 *
 * Server-side only; never exposes GROQ_API_KEY to the browser or in logs.
 */

import type {
  AiProvider,
  DraftGenerationRequest,
  DraftGenerationResult,
  PlanGenerationRequest,
  PlanGenerationResult,
} from "./types";
import { buildDraftPrompt, buildPlanPrompt } from "./prompts";

/** Candidate models in preference order for LinkedIn content generation */
const CANDIDATE_MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
] as const;

export class GroqProvider implements AiProvider {
  readonly id = "groq" as const;
  private readonly apiKey: string;
  private readonly configuredModel: string;
  private readonly timeoutMs: number;

  // Cached model state
  private selectedModel: string | null = null;
  private lastDiscoveryAt = 0;
  private readonly discoveryTtlMs = 60 * 60 * 1000; // 1 hour

  constructor(apiKey?: string, model?: string, timeoutMs = 15000) {
    this.apiKey = apiKey ?? process.env.GROQ_API_KEY ?? "";
    this.configuredModel = model ?? process.env.GROQ_DEFAULT_MODEL ?? "openai/gpt-oss-120b";
    this.timeoutMs = timeoutMs;
  }

  isConfigured(): boolean {
    return Boolean(
      this.apiKey &&
      this.apiKey.trim().length > 0 &&
      !this.apiKey.includes("your-groq")
    );
  }

  /**
   * Dynamically discovers and selects the best available model for the configured account.
   */
  async resolveModel(forceRefresh = false, excludeModel?: string): Promise<string> {
    const now = Date.now();
    if (!forceRefresh && this.selectedModel && now - this.lastDiscoveryAt < this.discoveryTtlMs) {
      return this.selectedModel;
    }

    if (!this.isConfigured()) {
      return this.configuredModel;
    }

    let availableIds: Set<string> | null = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch("https://api.groq.com/openai/v1/models", {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (res.ok) {
        const json = (await res.json()) as { data?: Array<{ id: string }> };
        availableIds = new Set((json.data || []).map((m) => m.id));
      }
    } catch {
      // Network or API discovery failure; use only a known supported fallback.
    }

    if (availableIds) {
      if (
        this.configuredModel !== excludeModel &&
        CANDIDATE_MODELS.includes(this.configuredModel as (typeof CANDIDATE_MODELS)[number]) &&
        availableIds.has(this.configuredModel)
      ) {
        this.selectedModel = this.configuredModel;
        this.lastDiscoveryAt = now;
        return this.selectedModel;
      }

      for (const candidate of CANDIDATE_MODELS) {
        if (candidate !== excludeModel && availableIds.has(candidate)) {
          this.selectedModel = candidate;
          this.lastDiscoveryAt = now;
          return this.selectedModel;
        }
      }

      throw new Error("No supported production Groq text model is available for this API key.");
    }

    // Discovery may be temporarily unavailable. Fall back only to a currently
    // supported production model, never to a stale environment override.
    this.selectedModel = CANDIDATE_MODELS.includes(this.configuredModel as (typeof CANDIDATE_MODELS)[number])
      ? this.configuredModel
      : CANDIDATE_MODELS[0];
    this.lastDiscoveryAt = now;
    return this.selectedModel;
  }

  async generateDraft(request: DraftGenerationRequest): Promise<DraftGenerationResult> {
    if (!this.isConfigured()) {
      throw new Error("GROQ_API_KEY is not configured or placeholder.");
    }

    let activeModel = await this.resolveModel();
    const { systemPrompt, userPrompt } = buildDraftPrompt(request);

    try {
      return await this.executeChatCompletion(activeModel, systemPrompt, userPrompt, request);
    } catch (err: any) {
      // If model not found or invalid, refresh model discovery and retry once with next available
      if (err.message && (err.message.includes("model_not_found") || err.message.includes("404"))) {
        activeModel = await this.resolveModel(true, activeModel);
        return await this.executeChatCompletion(activeModel, systemPrompt, userPrompt, request);
      }
      throw err;
    }
  }

  private async executeChatCompletion(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    request: DraftGenerationRequest
  ): Promise<DraftGenerationResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.7,
          max_completion_tokens: 2000,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Groq API returned HTTP ${response.status}: ${errorText.slice(0, 200)}`);
      }

      const json = (await response.json()) as any;
      const content = json.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error("Groq API returned empty completion.");
      }

      // Enforce character limit and strip em dashes (— U+2014, – U+2013)
      const safeText = content
        .replace(/\u2014/g, ",")   // em dash → comma
        .replace(/\u2013/g, "-")   // en dash → hyphen
        .slice(0, 3000);

      return {
        text: safeText,
        internalTitle: request.topic.length > 50 ? `${request.topic.slice(0, 47)}...` : request.topic,
        pillar: request.pillar,
        providerUsed: "groq",
        modelUsed: model,
        estimatedTokens: json.usage?.total_tokens ?? Math.round(safeText.length / 4),
        generatedAt: new Date().toISOString(),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async generatePlan(request: PlanGenerationRequest): Promise<PlanGenerationResult> {
    if (!this.isConfigured()) {
      throw new Error("GROQ_API_KEY is not configured or placeholder.");
    }

    let activeModel = await this.resolveModel();
    const { systemPrompt, userPrompt } = buildPlanPrompt(request);

    try {
      return await this.executePlanCompletion(activeModel, systemPrompt, userPrompt);
    } catch (err: any) {
      if (err.message && (err.message.includes("model_not_found") || err.message.includes("404"))) {
        activeModel = await this.resolveModel(true, activeModel);
        return await this.executePlanCompletion(activeModel, systemPrompt, userPrompt);
      }
      throw err;
    }
  }

  private async executePlanCompletion(
    model: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<PlanGenerationResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.5,
          response_format: { type: "json_object" },
          max_completion_tokens: 2400,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Groq API returned HTTP ${response.status}: ${errorText.slice(0, 200)}`);
      }

      const json = (await response.json()) as any;
      const rawJson = json.choices?.[0]?.message?.content?.trim();
      const parsed = JSON.parse(rawJson);

      return {
        topics: Array.isArray(parsed.topics) ? parsed.topics : [],
        summary: parsed.summary ?? "Generated content plan.",
        providerUsed: "groq",
        modelUsed: model,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
