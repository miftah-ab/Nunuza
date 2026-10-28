/**
 * AI Provider Types and Interfaces.
 *
 * Primary provider: Groq (llama-3.3-70b-versatile)
 * Fallback provider: OpenRouter (anthropic/claude-3-haiku)
 * Test/Offline provider: Deterministic Mock
 */

export interface VoiceProfileContext {
  tone?: string | null;
  sentenceLength?: string | null;
  formality?: string | null;
  phrasesUse?: string[] | null;
  phrasesAvoid?: string[] | null;
  sampleText?: string | null;
  exclusions?: string[] | null;
}

export interface ContentStrategyContext {
  audience?: Record<string, unknown> | null;
  goals?: string[] | null;
  pillars?: string[] | null;
  exclusions?: string[] | null;
  ctaPreferences?: string[] | null;
}

export interface DraftGenerationRequest {
  topic: string;
  pillar?: string;
  notes?: string;
  targetLength?: "short" | "medium" | "long"; // short (~500 chars), medium (~1200 chars), long (~2000 chars)
  voiceProfile?: VoiceProfileContext;
  strategy?: ContentStrategyContext;
  userRole?: string;
  companyName?: string;
}

export interface DraftGenerationResult {
  text: string;
  internalTitle: string;
  pillar?: string;
  providerUsed: "groq" | "openrouter" | "mock_deterministic";
  modelUsed: string;
  estimatedTokens: number;
  generatedAt: string;
}

export interface PlanTopicIdea {
  dayOffset: number; // 0 = first day of period, etc.
  date: string;
  pillar: string;
  title: string;
  angle: string;
  targetFormat: "story" | "breakdown" | "observation" | "lesson";
}

export interface PlanGenerationRequest {
  periodStart: string; // YYYY-MM-DD
  periodDays: number;  // 7 or 14
  cadencePerWeek: number; // 1 to 7
  preferredDays?: number[]; // 0=Sun .. 6=Sat
  strategy: ContentStrategyContext;
  userRole?: string;
}

export interface PlanGenerationResult {
  topics: PlanTopicIdea[];
  summary: string;
  providerUsed: "groq" | "openrouter" | "mock_deterministic";
  modelUsed: string;
}

export interface AiProvider {
  readonly id: "groq" | "openrouter" | "mock_deterministic";
  generateDraft(request: DraftGenerationRequest): Promise<DraftGenerationResult>;
  generatePlan(request: PlanGenerationRequest): Promise<PlanGenerationResult>;
}
