import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { apiError, ok, parseBody } from "@/lib/api/respond";
import { aiService } from "@/lib/ai/service";
import { getContentStrategy, getVoiceProfile } from "@/lib/db/workspace";
import { consumeVoiceTestAllowance } from "@/lib/db/usage";
import { assertVoiceConstraints, VoiceConstraintError } from "@/lib/ai/voice-constraints";

export async function POST(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const body = await parseBody<{ topic?: unknown }>(request);
    if (typeof body?.topic !== "string" || !body.topic.trim() || body.topic.length > 300) {
      return NextResponse.json({ error: "Enter a topic of no more than 300 characters." }, { status: 400 });
    }

    const [voice, strategy] = await Promise.all([
      getVoiceProfile(workspace.id),
      getContentStrategy(workspace.id),
    ]);
    if (!voice) {
      return NextResponse.json({ error: "Save a Voice profile before testing it." }, { status: 409 });
    }

    const voiceContext = {
      tone: voice.tone,
      sentenceLength: voice.sentence_length,
      formality: voice.formality,
      phrasesUse: voice.phrases_use,
      phrasesAvoid: voice.phrases_avoid,
      sampleText: voice.sample_text,
      exclusions: voice.exclusions,
    };
    assertVoiceConstraints(body.topic.trim(), voiceContext);

    if (!(await consumeVoiceTestAllowance(workspace.id))) {
      return NextResponse.json({ error: "Voice preview limit reached. Try again next hour." }, { status: 429 });
    }

    const result = await aiService.generateDraft({
      topic: body.topic.trim(),
      targetLength: "medium",
      voiceProfile: voiceContext,
      strategy: strategy ? {
        audience: strategy.audience,
        goals: strategy.goals,
        pillars: Array.isArray(strategy.pillars)
          ? strategy.pillars.map((p) => typeof p === "string" ? p : JSON.stringify(p))
          : undefined,
        exclusions: strategy.exclusions,
        ctaPreferences: strategy.cta_preferences,
      } : undefined,
    });
    assertVoiceConstraints(result.text, voiceContext);

    return ok({
      text: result.text,
      providerUsed: result.providerUsed,
      modelUsed: result.modelUsed,
      generatedAt: result.generatedAt,
    });
  } catch (error) {
    if (error instanceof VoiceConstraintError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return apiError(error);
  }
}
