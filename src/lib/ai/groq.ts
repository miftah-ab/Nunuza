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
  "llama-3.3-70b-versatile",
  "llama-3.1-70b-versatile",
  "llama3-70b-8192",
  "openai/gpt-oss-120b",
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-20b",
  "mixtral-8x7b-32768",
  "llama-3.1-8b-instant",
  "llama3-8b-8192",
];

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
    this.configuredModel = model ?? process.env.GROQ_DEFAULT_MODEL ?? "llama-3.3-70b-versatile";
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
  async resolveModel(forceRefresh = false): Promise<string> {
    const now = Date.now();
    if (!forceRefresh && this.selectedModel && now - this.lastDiscoveryAt < this.discoveryTtlMs) {
      return this.selectedModel;
    }

    if (!this.isConfigured()) {
      return this.configuredModel;
    }

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
        const availableIds = new Set((json.data || []).map((m) => m.id));

        // 1. If explicit configuredModel is available, prioritize it
        if (this.configuredModel && availableIds.has(this.configuredModel)) {
          this.selectedModel = this.configuredModel;
          this.lastDiscoveryAt = now;
          return this.selectedModel;
        }

        // 2. Otherwise pick the top matching model from candidate ranking
        for (const candidate of CANDIDATE_MODELS) {
          if (availableIds.has(candidate)) {
            this.selectedModel = candidate;
            this.lastDiscoveryAt = now;
            return this.selectedModel;
          }
        }

        // 3. Fallback: filter for any non-whisper, non-guard text model
        const textModel = Array.from(availableIds).find(
          (id) => !id.includes("whisper") && !id.includes("guard")
        );
        if (textModel) {
          this.selectedModel = textModel;
          this.lastDiscoveryAt = now;
          return this.selectedModel;
        }
      }
    } catch {
      // Network or API discovery failure; keep fail-safe fallback
    }

    // Default to configured model if discovery is unreachable
    this.selectedModel = this.configuredModel;
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
        activeModel = await this.resolveModel(true);
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
          max_tokens: 1200,
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

      // Enforce character limit
      const safeText = content.slice(0, 3000);

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
        activeModel = await this.resolveModel(true);
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
          max_tokens: 1800,
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
