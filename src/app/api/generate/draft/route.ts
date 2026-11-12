/**
 * POST /api/generate/draft — AI draft generation endpoint.
 *
 * Implements Phase 3 draft generation pipeline:
 * 1. Derives workspace strictly from session via requireWorkspace()
 * 2. Enforces monthly usage limit (30 workflow items/month, BED-02)
 * 3. Enriches prompt with workspace voice profile and content strategy
 * 4. Calls AI service (Groq -> OpenRouter -> Deterministic Mock)
 * 5. Saves draft to content_posts and appends post version
 * 6. Increments atomic usage counter and creates audit event
 */

import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { ok, apiError, parseBody } from "@/lib/api/respond";
import { aiService } from "@/lib/ai/service";
import { checkDraftLimit, incrementDraftCounter } from "@/lib/db/usage";
import { createPost } from "@/lib/db/posts";
import { getVoiceProfile, getContentStrategy, logAuditEvent } from "@/lib/db/workspace";
import { createClient } from "@/lib/supabase/server";
import { notifyWorkspaceTelegram } from "@/lib/integrations/telegram/service";
import { assertNoExcludedPhrase } from "@/lib/ai/exclusions";
import { assertVoiceConstraints, VoiceConstraintError } from "@/lib/ai/voice-constraints";

interface GenerateDraftBody {
  topic: string;
  pillar?: string;
  notes?: string;
  targetLength?: "short" | "medium" | "long";
}

export async function POST(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const body = await parseBody<GenerateDraftBody>(request);

    if (!body || !body.topic || body.topic.trim().length === 0) {
      return NextResponse.json(
        { error: "A topic or prompt is required to generate a draft." },
        { status: 400 }
      );
    }

    // 1. Enforce monthly draft quota (30 items/month)
    const usage = await checkDraftLimit(workspace.id);
    if (usage.isAtLimit) {
      return NextResponse.json(
        {
          error: `Monthly limit reached (${usage.count}/${usage.limit} items). Resets on ${usage.resetsOn}.`,
          code: "USAGE_LIMIT_EXCEEDED",
        },
        { status: 429 }
      );
    }

    // 2. Fetch context: voice profile, strategy, and user profile
    const supabase = await createClient();
    const [voice, strategy, { data: profile }] = await Promise.all([
      getVoiceProfile(workspace.id),
      getContentStrategy(workspace.id),
      supabase.from("profiles").select("display_name").eq("id", workspace.owner_user_id).single(),
    ]);

    const voiceContext = voice
      ? {
          tone: voice.tone,
          sentenceLength: voice.sentence_length,
          formality: voice.formality,
          phrasesUse: voice.phrases_use,
          phrasesAvoid: voice.phrases_avoid,
          sampleText: voice.sample_text,
          exclusions: voice.exclusions,
        }
      : undefined;
    assertVoiceConstraints(
      [body.topic.trim(), body.pillar?.trim() ?? "", body.notes?.trim() ?? ""].join("\n"),
      voiceContext
    );

    // Enforce configured exclusions before generation and against the returned text.
    assertNoExcludedPhrase(
      [body.topic.trim(), body.pillar?.trim(), body.notes?.trim()].filter(Boolean).join(" "),
      strategy?.exclusions,
      "draft request"
    );

    // 3. Generate draft using AI service
    const generationResult = await aiService.generateDraft({
      topic: body.topic.trim(),
      pillar: body.pillar?.trim(),
      notes: body.notes?.trim(),
      targetLength: body.targetLength,
      userRole: profile?.display_name ?? undefined,
      voiceProfile: voiceContext,
      strategy: strategy
        ? {
            audience: strategy.audience,
            goals: strategy.goals,
            pillars: Array.isArray(strategy.pillars)
              ? strategy.pillars.map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
              : undefined,
            exclusions: strategy.exclusions,
            ctaPreferences: strategy.cta_preferences,
          }
        : undefined,
    });

    assertNoExcludedPhrase(generationResult.text, strategy?.exclusions, "generated draft");
    assertVoiceConstraints(generationResult.text, voiceContext);

    // 4. Persist post to DB in draft status
    const post = await createPost(workspace.id, workspace.owner_user_id, {
      text: generationResult.text,
      internal_title: generationResult.internalTitle,
      pillar: generationResult.pillar ?? body.pillar,
      source_notes: body.notes,
    });

    // 5. Increment atomic usage counter
    await incrementDraftCounter(workspace.id);

    // 6. Record audit event
    await logAuditEvent({
      workspaceId: workspace.id,
      actorType: "user",
      actorId: workspace.owner_user_id,
      action: "generate_draft",
      resourceType: "content_post",
      resourceId: post.id,
      safeMetadata: {
        providerUsed: generationResult.providerUsed,
        modelUsed: generationResult.modelUsed,
        estimatedTokens: generationResult.estimatedTokens,
      },
    });

    // 7. Proactive notification to linked Telegram chat (BED-09)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const snippet = (post.text || "").slice(0, 140).replace(/\n/g, " ");
    notifyWorkspaceTelegram(workspace.id, {
      text:
        `🔔 **New Draft Ready for Review**\n\n` +
        `**${post.internal_title || "LinkedIn Draft"}**\n\n` +
        `"${snippet}..."\n\n` +
        `• Quick Approve: \`/approve ${post.id.slice(0, 8)}\`\n` +
        `• Reject: \`/reject ${post.id.slice(0, 8)}\``,
      replyMarkup: {
        inline_keyboard: [
          [{ text: "📝 Review in Nunuza", url: `${appUrl}/app/content` }],
        ],
      },
    }).catch(() => {});

    return ok({
      post,
      metadata: {
        providerUsed: generationResult.providerUsed,
        modelUsed: generationResult.modelUsed,
        estimatedTokens: generationResult.estimatedTokens,
        generatedAt: generationResult.generatedAt,
      },
    }, 201);
  } catch (err) {
    if (err instanceof VoiceConstraintError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return apiError(err);
  }
}
