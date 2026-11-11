import crypto from "crypto";
import { aiService } from "@/lib/ai/service";
import { assertNoExcludedPhrase } from "@/lib/ai/exclusions";
import { assertVoiceConstraints } from "@/lib/ai/voice-constraints";
import { getCalendarMonthPeriod } from "@/lib/db/usage";

type ConversationState = { activePostId?: string; topic?: string; pillar?: string; updatedAt?: string };
type TelegramConversationInput = {
  telegramUserId: number; chatId: number; workspaceId: string; ownerUserId: string; text: string; supabase: any;
};
export type TelegramConversationResult = { replyText: string; replyMarkup?: any };

function escapeMarkdownV2(value: string): string {
  return value.replace(/[_*[\\]()~\x60>#+=|{}.!\\-]/g, "\\$&");
}

export function isRevisionRequest(text: string, hasActiveDraft: boolean): boolean {
  if (!hasActiveDraft) return false;
  const value = text.trim().toLocaleLowerCase();
  if (/^\\/(new|cancel)\\b/.test(value)) return false;
  if (/\\b(new post|another post|different topic|write a post|create a post|draft a post|generate a post|post about)\\b/.test(value)) return false;
  return /\\b(edit|revise|rewrite|shorter|shorten|longer|expand|stronger|punchier|improve|change|replace|remove|add|less|more|simpler|simplify|try again|another angle|different angle|make it|turn it)\\b/.test(value);
}

function readConversationState(value: unknown): ConversationState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const state = value as Record<string, unknown>;
  return {
    ...(typeof state.activePostId === "string" ? { activePostId: state.activePostId } : {}),
    ...(typeof state.topic === "string" ? { topic: state.topic.slice(0, 500) } : {}),
    ...(typeof state.pillar === "string" ? { pillar: state.pillar.slice(0, 120) } : {}),
    ...(typeof state.updatedAt === "string" ? { updatedAt: state.updatedAt } : {}),
  };
}

async function releaseConversation(input: TelegramConversationInput, lockToken: string, state: ConversationState): Promise<void> {
  const { error } = await input.supabase.rpc("release_telegram_conversation", {
    p_telegram_user_id: input.telegramUserId, p_chat_id: input.chatId,
    p_workspace_id: input.workspaceId, p_lock_token: lockToken, p_state: state,
  });
  if (error) console.error("[telegram-conversation] Could not persist conversation state:", error.code || "database_error");
}

function helpReply(): TelegramConversationResult {
  return {
    replyText:
      "✍️ *Create a LinkedIn post by chatting with me.*\n\n" +
      "Tell me the topic, point of view, audience, or rough idea. I'll create a draft using your workspace strategy and voice profile.\n\n" +
      "Then ask me to revise it naturally, for example: _make the opening stronger_, _shorten it_, or _add a practical example_.\n\n" +
      "Your draft is saved in Nunuza. I never publish from a chat-generation request. Use /new to start another post or /cancel to leave the current draft unchanged.",
  };
}

export async function handleTelegramConversation(input: TelegramConversationInput): Promise<TelegramConversationResult> {
  const text = input.text.trim();
  if (!text) return { replyText: "Tell me what you want your LinkedIn post to be about." };
  if (text === "/help") return helpReply();

  const lockToken = crypto.randomUUID();
  const { data: claim, error: claimError } = await input.supabase.rpc("claim_telegram_conversation", {
    p_telegram_user_id: input.telegramUserId, p_chat_id: input.chatId,
    p_workspace_id: input.workspaceId, p_lock_token: lockToken,
  });
  if (claimError) {
    console.error("[telegram-conversation] Could not claim conversation:", claimError.code || "database_error");
    return { replyText: "I couldn't open your content session right now. Please try again." };
  }
  if (!claim?.claimed) {
    if (claim?.reason === "busy") return { replyText: "I'm still working on your previous message. Give me a moment, then send your next instruction." };
    return { replyText: "Your Telegram link is no longer active. Reconnect it from Nunuza Integrations." };
  }

  let state = readConversationState(claim.state);
  const expired = state.updatedAt ? Date.now() - new Date(state.updatedAt).getTime() > 24 * 60 * 60 * 1000 : false;
  if (expired) state = {};

  try {
    if (text === "/cancel") {
      await releaseConversation(input, lockToken, {});
      return { replyText: "Cancelled this chat session. Any draft already saved in Nunuza is unchanged. Send a new idea whenever you're ready." };
    }
    if (text === "/new") {
      await releaseConversation(input, lockToken, {});
      return { replyText: "Ready for a new post. Tell me what you want to write about." };
    }

    const isRevision = isRevisionRequest(text, Boolean(state.activePostId));
    let existingPost: any = null;
    if (isRevision && state.activePostId) {
      const { data, error } = await input.supabase.from("content_posts")
        .select("id, text, internal_title, pillar, version, status")
        .eq("workspace_id", input.workspaceId).eq("id", state.activePostId).maybeSingle();
      if (error) throw new Error("Could not load the active draft.");
      if (data?.status === "draft") existingPost = data;
      else state = {};
    }

    const [voiceResult, strategyResult, profileResult] = await Promise.all([
      input.supabase.from("voice_profiles").select("*").eq("workspace_id", input.workspaceId).maybeSingle(),
      input.supabase.from("content_strategies").select("*").eq("workspace_id", input.workspaceId).maybeSingle(),
      input.supabase.from("profiles").select("display_name").eq("id", input.ownerUserId).maybeSingle(),
    ]);
    if (voiceResult.error || strategyResult.error || profileResult.error) throw new Error("Could not load your workspace writing settings.");

    const voice = voiceResult.data;
    const strategy = strategyResult.data;
    const profile = profileResult.data;
    const voiceContext = voice ? {
      tone: voice.tone, sentenceLength: voice.sentence_length, formality: voice.formality,
      phrasesUse: voice.phrases_use, phrasesAvoid: voice.phrases_avoid,
      sampleText: voice.sample_text, exclusions: voice.exclusions,
    } : undefined;

    assertVoiceConstraints(text, voiceContext);
    assertNoExcludedPhrase(text, strategy?.exclusions, "content request");

    const { periodStart, periodEnd } = getCalendarMonthPeriod();
    if (!existingPost) {
      const { data: usage, error: usageError } = await input.supabase.from("usage_counters")
        .select("count").eq("workspace_id", input.workspaceId)
        .eq("metric", "draft_items_created").eq("period_start", periodStart).maybeSingle();
      if (usageError) throw new Error("Could not verify your monthly draft allowance.");
      if (Number(usage?.count ?? 0) >= 30) {
        await releaseConversation(input, lockToken, state);
        return { replyText: "You've reached this workspace's monthly draft limit (30). It resets on the first day of next month. Your existing drafts are safe." };
      }
    }

    const topic = existingPost ? (state.topic || existingPost.internal_title || "LinkedIn post") : text.slice(0, 500);
    const pillar = existingPost?.pillar || state.pillar;
    const strategyContext = strategy ? {
      audience: strategy.audience, goals: strategy.goals,
      pillars: Array.isArray(strategy.pillars) ? strategy.pillars.map((p: unknown) => typeof p === "string" ? p : JSON.stringify(p)) : undefined,
      exclusions: strategy.exclusions, ctaPreferences: strategy.cta_preferences,
    } : undefined;

    const generation = await aiService.generateDraft({
      topic, pillar: pillar || undefined, targetLength: "medium",
      userRole: profile?.display_name ?? undefined, voiceProfile: voiceContext, strategy: strategyContext,
      ...(existingPost ? { revision: { previousDraft: existingPost.text, instruction: text } } : {}),
    });

    if (generation.providerUsed === "mock_deterministic") {
      await releaseConversation(input, lockToken, state);
      return { replyText: "The AI providers are unavailable, so I couldn't generate a real draft. Please try again when the Groq or OpenRouter connection is healthy. Nothing was saved." };
    }

    assertNoExcludedPhrase(generation.text, strategy?.exclusions, "generated draft");
    assertVoiceConstraints(generation.text, voiceContext);

    let post: any;
    if (existingPost) {
      const nextVersion = Number(existingPost.version || 1) + 1;
      const { data, error } = await input.supabase.from("content_posts").update({
        text: generation.text, version: nextVersion,
        internal_title: generation.internalTitle || existingPost.internal_title,
      }).eq("workspace_id", input.workspaceId).eq("id", existingPost.id).eq("status", "draft")
        .select("id, text, internal_title, pillar, version, status").single();
      if (error || !data) throw new Error("The draft changed while I was revising it. Refresh /drafts and try again.");
      post = data;
      const { error: versionError } = await input.supabase.from("content_post_versions").insert({
        workspace_id: input.workspaceId, post_id: post.id, version_number: nextVersion,
        text: generation.text, change_source: "ai_revision", changed_by: input.ownerUserId,
      });
      if (versionError) console.error("[telegram-conversation] Revision version history write failed:", versionError.code || "database_error");
    } else {
      const { data, error } = await input.supabase.from("content_posts").insert({
        workspace_id: input.workspaceId, created_by: input.ownerUserId, text: generation.text,
        internal_title: generation.internalTitle, pillar: generation.pillar ?? null,
        source_notes: text.slice(0, 2000), status: "draft", version: 1,
      }).select("id, text, internal_title, pillar, version, status").single();
      if (error || !data) throw new Error("I generated the post but couldn't save it. Please try again.");
      post = data;
      const { error: versionError } = await input.supabase.from("content_post_versions").insert({
        workspace_id: input.workspaceId, post_id: post.id, version_number: 1,
        text: generation.text, change_source: "user_edit", changed_by: input.ownerUserId,
      });
      if (versionError) console.error("[telegram-conversation] Initial version history write failed:", versionError.code || "database_error");
      const { error: counterError } = await input.supabase.rpc("increment_usage_counter", {
        p_workspace_id: input.workspaceId, p_metric: "draft_items_created",
        p_period_start: periodStart, p_period_end: periodEnd,
      });
      if (counterError) console.error("[telegram-conversation] Draft usage counter increment failed:", counterError.code || "database_error");
    }

    await input.supabase.from("audit_events").insert({
      workspace_id: input.workspaceId, actor_type: "telegram", actor_id: input.ownerUserId,
      action: existingPost ? "telegram_draft_revised" : "telegram_draft_created",
      resource_type: "content_post", resource_id: post.id,
      safe_metadata: { providerUsed: generation.providerUsed, modelUsed: generation.modelUsed, estimatedTokens: generation.estimatedTokens },
    });

    state = {
      activePostId: post.id, topic: topic.slice(0, 500),
      ...(post.pillar ? { pillar: post.pillar } : {}), updatedAt: new Date().toISOString(),
    };
    await releaseConversation(input, lockToken, state);

    const title = escapeMarkdownV2(post.internal_title || "LinkedIn draft");
    const body = escapeMarkdownV2(post.text || "");
    return {
      replyText:
        (existingPost ? "✏️ *Draft revised*\\n\\n" : "📝 *New draft created*\\n\\n") +
        "*" + title + "*\\n\\n" + body + "\\n\\n" +
        "Draft ID: " + post.id.slice(0, 8) + "\\n" +
        "Saved in Nunuza as a draft. It has not been published.\\n\\n" +
        "Send a revision instruction to keep editing this draft, /new for another post, or /cancel to end this session.",
    };
  } catch (error) {
    await releaseConversation(input, lockToken, state);
    if (error instanceof Error && (error.name === "VoiceConstraintError" || error.name === "StrategyExclusionError")) {
      return { replyText: escapeMarkdownV2(error.message) };
    }
    console.error("[telegram-conversation] Content operation failed:", error instanceof Error ? error.message : "unknown_error");
    return { replyText: "I couldn't complete that content request. Your existing draft has been left unchanged. Please try again with a clearer instruction." };
  }
}
