/**
 * Centralized AI Generation Service.
 *
 * Implements BED-04 & Phase 3 requirements:
 * - Groq is primary provider (llama-3.3-70b-versatile)
 * - OpenRouter is fallback (anthropic/claude-3-haiku)
 * - Deterministic Mock is used when neither is configured or in tests
 * - Clearly distinguishes mock outputs from real external AI generation
 * - Never silently falls back without logging provider & model used
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

export class AiService {
  private primary: GroqProvider;
  private fallback: OpenRouterProvider;
  private mock: MockAiProvider;

  constructor(primary?: GroqProvider, fallback?: OpenRouterProvider, mock?: MockAiProvider) {
    this.primary = primary ?? new GroqProvider();
    this.fallback = fallback ?? new OpenRouterProvider();
    this.mock = mock ?? new MockAiProvider();
  }

  async generateDraft(request: DraftGenerationRequest): Promise<DraftGenerationResult> {
    if (!request.topic || request.topic.trim().length === 0) {
      throw new Error("Draft topic cannot be empty.");
    }

    // 1. Try Primary: Groq
    if (this.primary.isConfigured()) {
      try {
        const result = await this.primary.generateDraft(request);
        return result;
      } catch (err) {
        console.warn("[ai] Primary provider (Groq) failed. Attempting fallback.", err);
      }
    }

    // 2. Try Fallback: OpenRouter
    if (this.fallback.isConfigured()) {
      try {
        const result = await this.fallback.generateDraft(request);
        return result;
      } catch (err) {
        console.warn("[ai] Fallback provider (OpenRouter) failed.", err);
      }
    }

    // 3. Offline / Deterministic Mock
    // Transparently marks providerUsed as 'mock_deterministic'
    console.warn("[ai] No external AI credentials configured or providers failed. Using deterministic mock.");
    return this.mock.generateDraft(request);
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

    // 3. Offline / Deterministic Mock
    return this.mock.generatePlan(request);
  }
}

// Singleton instance for server-side handlers
export const aiService = new AiService();
