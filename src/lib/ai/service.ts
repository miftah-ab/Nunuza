/**
 * Centralized AI Generation Service.
 *
 * Implements BED-04 & Phase 3 requirements:
 * - Groq is primary provider (llama-3.3-70b-versatile)
 * - OpenRouter is fallback (anthropic/claude-3-haiku)
 * - Deterministic Mock is available only when explicitly injected by tests
 * - Production requests fail closed when both real providers are unavailable
 * - Never presents canned mock content as successful AI generation
 * - Validates input and output character boundaries (<= 3000 chars)
 */

import type {
  AiProvider,
  DraftGenerationRequest,
  DraftGenerationResult,
  PlanGenerationRequest,
  PlanGenerationResult,
} from "./types";
import { GroqProvider } from "./groq";
import { OpenRouterProvider } from "./openrouter";
import { MockAiProvider } from "./mock";
import { normalizeLinkedInPostText } from "./plain-text";

export class AiService {
  private primary: GroqProvider;
  private fallback: OpenRouterProvider;
  private mock?: MockAiProvider;

  constructor(primary?: GroqProvider, fallback?: OpenRouterProvider, mock?: MockAiProvider) {
    this.primary = primary ?? new GroqProvider();
    this.fallback = fallback ?? new OpenRouterProvider();
    this.mock = mock;
  }

  async generateDraft(request: DraftGenerationRequest): Promise<DraftGenerationResult> {
    if (!request.topic || request.topic.trim().length === 0) {
      throw new Error("Draft topic cannot be empty.");
    }

    // 1. Try Primary: Groq
    if (this.primary.isConfigured()) {
      try {
        const result = await this.primary.generateDraft(request);
        return this.normalizeDraftResult(result);
      } catch (err) {
        console.warn("[ai] Primary provider (Groq) failed. Attempting fallback.", err);
      }
    }

    // 2. Try Fallback: OpenRouter
    if (this.fallback.isConfigured()) {
      try {
        const result = await this.fallback.generateDraft(request);
        return this.normalizeDraftResult(result);
      } catch (err) {
        console.warn("[ai] Fallback provider (OpenRouter) failed.", err);
      }
    }

    // Mocks are test-only and must be explicitly injected. Production never
    // saves a canned template as if it were a real generated draft.
    if (this.mock) {
      return this.normalizeDraftResult(await this.mock.generateDraft(request));
    }
    throw new Error(
      "AI_GENERATION_UNAVAILABLE: Nunuza could not reach its configured AI providers. Your draft was not created. Please try again shortly."
    );
  }

  private normalizeDraftResult(result: DraftGenerationResult): DraftGenerationResult {
    return { ...result, text: normalizeLinkedInPostText(result.text).slice(0, 3000) };
  }

  async generatePlan(request: PlanGenerationRequest): Promise<PlanGenerationResult> {
    if (request.cadencePerWeek < 1 || request.cadencePerWeek > 7) {
      throw new Error("Cadence must be between 1 and 7 posts per week.");
    }

    // 1. Try Primary: Groq
    if (this.primary.isConfigured()) {
      try {
        const result = await this.primary.generatePlan(request);
        return result;
      } catch (err) {
        console.warn("[ai] Primary provider (Groq) plan generation failed.", err);
      }
    }

    // 2. Try Fallback: OpenRouter
    if (this.fallback.isConfigured()) {
      try {
        const result = await this.fallback.generatePlan(request);
        return result;
      } catch (err) {
        console.warn("[ai] Fallback provider (OpenRouter) plan generation failed.", err);
      }
    }

    if (this.mock) return this.mock.generatePlan(request);
    throw new Error(
      "AI_PLAN_UNAVAILABLE: Nunuza could not reach its configured AI providers. Your plan was not created. Please try again shortly."
    );
  }
}

// Singleton instance for server-side handlers
export const aiService = new AiService();
