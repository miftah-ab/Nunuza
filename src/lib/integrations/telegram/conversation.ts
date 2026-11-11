import crypto from "crypto";
import { aiService } from "@/lib/ai/service";
import { assertNoExcludedPhrase, StrategyExclusionError } from "@/lib/ai/exclusions";
import { assertVoiceConstraints, VoiceConstraintError } from "@/lib/ai/voice-constraints";
import { getCalendarMonthPeriod } from "@/lib/db/usage";
import type { AgentJob } from "@/types/database";
import type { JobExecutionResult } from "@/lib/jobs/types";

type ConversationState = {
  activePostId?: string;
  topic?: string;
  pillar?: string;
  updatedAt?: string;
  pendingJobId?: string;
  pendingSince?: string;
};

type TelegramConversationInput = {
  telegramUserId: number;
  chatId: number;
  workspaceId: string;
  ownerUserId: string;
  updateId?: number;
  text: string;
  supabase: any;
};

type TelegramContentJobPayload = {
  telegramUserId: number;
  chatId: number;
  ownerUserId: string;
  text: string;
  mode: "new" | "revision";
  activePostId?: string;
  topic: string;
  pillar?: string;
};

export type TelegramConversationResult = { replyText: string; replyMarkup?: any };

function escapeMarkdownV2(value: string): string {
  return value.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

export function isRevisionRequest(text: string, hasActiveDraft: boolean): boolean {
  if (!hasActiveDraft) return false;
  const value = text.trim().toLocaleLowerCase();
  if (/^\/(new|cancel)\b/.test(value)) return false;
  if (/\b(new post|another post|different topic|write a post|create a post|draft a post|generate a post|post about)\b/.test(value)) return false;
  return /\b(edit|revise|rewrite|shorter|shorten|longer|expand|stronger|punchier|improve|change|replace|remove|add|less|more|simpler|simplify|try again|another angle|different angle|make it|turn it)\b/.test(value);
}

function readConversationState(value: unknown): ConversationState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const state = value as Record<string, unknown>;
  return {
    ...(typeof state.activePostId === "string" ? { activePostId: state.activePostId } : {}),
    ...(typeof state.topic === "string" ? { topic: state.topic.slice(0, 500) } : {}),
    ...(typeof state.pillar === "string" ? { pillar: state.pillar.slice(0, 120) } : {}),
    ...(typeof state.updatedAt === "string" ? { updatedAt: state.updatedAt } : {}),
    ...(typeof state.pendingJobId === "string" ? { pendingJobId: state.pendingJobId } : {}),
    ...(typeof state.pendingSince === "string" ? { pendingSince: state.pendingSince } : {}),
  };
}

function stateWithoutPending(state: ConversationState): ConversationState {
  return {
    ...(state.activePostId ? { activePostId: state.activePostId } : {}),
    ...(state.topic ? { topic: state.topic } : {}),
    ...(state.pillar ? { pillar: state.pillar } : {}),
    updatedAt: new Date().toISOString(),
  };
}

async function releaseConversation(
  input: TelegramConversationInput,
  lockToken: string,
  state: ConversationState
): Promise<void> {
  const { error } = await input.supabase.rpc("release_telegram_conversation", {
    p_telegram_user_id: input.telegramUserId,
    p_chat_id: input.chatId,
    p_workspace_id: input.workspaceId,
    p_lock_token: lockToken,
    p_state: state,
  });
  if (error) throw new Error("Could not persist Telegram conversation state.");
}

async function completeConversationJob(
  supabase: any,
  payload: TelegramContentJobPayload,
  workspaceId: string,
  jobId: string,
  state: ConversationState
): Promise<boolean> {
  const { data, error } = await supabase.rpc("complete_telegram_conversation_job", {
    p_telegram_user_id: payload.telegramUserId,
    p_chat_id: payload.chatId,
    p_workspace_id: workspaceId,
    p_job_id: jobId,
    p_state: state,
  });
  if (error) throw new Error("Could not complete Telegram conversation state.");
  return data === true;
}

async function sendConversationReply(chatId: number, text: string, replyMarkup?: any): Promise<void> {
  try {
    const { sendTelegramMessage } = await import("./service");
    const delivery = await sendTelegramMessage(chatId, text, replyMarkup);
    if (!delivery.ok) {
      // The saved draft remains available through /drafts if Telegram delivery fails.
      console.error("[telegram-conversation] Draft reply delivery failed:", delivery.error || "telegram_delivery_error");
    }
  } catch {
    console.error("[telegram-conversation] Draft reply delivery failed:", "telegram_delivery_exception");
  }
}

function helpReply(): TelegramConversationResult {
  return {
    replyText:
      "✍️ *Create a LinkedIn post by chatting with me.*\n\n" +
      "Tell me the topic, point of view, audience, or rough idea. I'll create a draft using your workspace strategy and voice profile.\n\n" +
      "Then ask me to revise it naturally, for example: _make the opening stronger_, _shorten it_, or _add a practical example_.\n\n" +
      "Your draft is saved in Nunuza. I never publish from a chat-generation request. Use /new to start another post. /cancel ends an idle chat session; an in-progress generation must finish first.",
  };
}

export async function handleTelegramConversation(input: TelegramConversationInput): Promise<TelegramConversationResult> {
  const text = input.text.trim();
  if (!text) return { replyText: "Tell me what you want your LinkedIn post to be about." };
  if (text.length > 4000) return { replyText: "That message is too long. Keep a content request under 4,000 characters and send it again." };
  if (text === "/help" || (text.startsWith("/") && text !== "/new" && text !== "/cancel")) return helpReply();

  const lockToken = crypto.randomUUID();
  const { data: claim, error: claimError } = await input.supabase.rpc("claim_telegram_conversation", {
    p_telegram_user_id: input.telegramUserId,
    p_chat_id: input.chatId,
    p_workspace_id: input.workspaceId,
    p_lock_token: lockToken,
  });
  if (claimError) {
    console.error("[telegram-conversation] Could not claim conversation:", claimError.code || "database_error");
    return { replyText: "I couldn't open your content session right now. Please try again." };
  }
  if (!claim?.claimed) {
    if (claim?.reason === "busy") return { replyText: "I'm still processing your previous message. I'll send the draft here when it's ready." };
    return { replyText: "Your Telegram link is no longer active. Reconnect it from Nunuza Integrations." };
  }

  let state = readConversationState(claim.state);
  const expired = state.updatedAt ? Date.now() - new Date(state.updatedAt).getTime() > 24 * 60 * 60 * 1000 : false;
  if (expired && !state.pendingJobId) state = {};

  try {
    if (state.pendingJobId) {
      const { data: pendingJob, error: pendingError } = await input.supabase.from("agent_jobs")
        .select("id, status").eq("id", state.pendingJobId).eq("workspace_id", input.workspaceId).maybeSingle();
      if (pendingError) throw new Error("Could not verify the pending content request.");
      if (pendingJob && ["queued", "running", "failed_retryable"].includes(pendingJob.status)) {
        await releaseConversation(input, lockToken, state);
        return { replyText: "I'm still working on your previous post. Wait for my reply before starting another content request." };
      }
      if (pendingJob?.status === "succeeded" && state.activePostId) {
        await releaseConversation(input, lockToken, stateWithoutPending(state));
        return { replyText: "Your previous draft is ready. Use /drafts to review it, or send a new post idea." };
      }
      state = stateWithoutPending(state);
    }

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
      else {
        await releaseConversation(input, lockToken, {});
        return { replyText: "That draft is no longer editable from this chat. It may have been approved, rejected, or deleted. Send /new to start another post." };
      }
    }

    const topic = existingPost
      ? (state.topic || existingPost.internal_title || "LinkedIn post")
      : text.slice(0, 500);
    const idempotencyKey = "telegram-content-" + String(input.updateId ?? lockToken);
    const payload: TelegramContentJobPayload = {
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      ownerUserId: input.ownerUserId,
      text,
      mode: existingPost ? "revision" : "new",
      ...(existingPost ? { activePostId: existingPost.id } : {}),
      topic,
      ...(existingPost?.pillar || state.pillar ? { pillar: existingPost?.pillar || state.pillar } : {}),
    };
    const jobId = crypto.randomUUID();
    const nextState: ConversationState = {
      ...(state.activePostId ? { activePostId: state.activePostId } : {}),
      topic,
      ...(payload.pillar ? { pillar: payload.pillar } : {}),
      updatedAt: new Date().toISOString(),
    };
    const { data: enqueueResult, error: enqueueError } = await input.supabase.rpc("enqueue_telegram_content_job", {
      p_telegram_user_id: input.telegramUserId,
      p_chat_id: input.chatId,
      p_workspace_id: input.workspaceId,
      p_lock_token: lockToken,
      p_job_id: jobId,
      p_idempotency_key: idempotencyKey,
      p_payload: payload,
      p_conversation_state: nextState,
    });
    if (enqueueError) throw new Error("Could not queue your content request.");
    if (!enqueueResult?.queued) {
      if (enqueueResult?.reason === "already_completed") {
        return { replyText: "That request has already completed. Use /drafts to find the saved post." };
      }
      if (enqueueResult?.reason === "previous_failed") {
        return { replyText: "Your previous attempt failed. Send the content request again to retry it." };
      }
      return { replyText: "Your content session changed while I was queueing that request. Please send it again." };
    }

    return {
      replyText:
        "⏳ I'm working on your LinkedIn post now. I'll send the draft here when it's ready.\n\n" +
        "You can keep using /status and /drafts. Wait for my reply before sending another content request.\n\n" +
        "Nothing is published by this request.",
    };
  } catch (error) {
    await releaseConversation(input, lockToken, state);
    console.error("[telegram-conversation] Could not queue content request:", error instanceof Error ? error.message : "unknown_error");
    return { replyText: "I couldn't queue that content request. Your existing draft is unchanged. Please try again." };
  }
}

function safeStateFromPayload(payload: TelegramContentJobPayload, postId?: string, pillar?: string): ConversationState {
  return {
    ...(postId ? { activePostId: postId } : {}),
    topic: payload.topic.slice(0, 500),
    ...(pillar ? { pillar: pillar.slice(0, 120) } : {}),
    updatedAt: new Date().toISOString(),
  };
}

async function loadExistingPostByJob(supabase: any, workspaceId: string, jobId: string): Promise<any | null> {
  const { data, error } = await supabase.from("content_posts")
    .select("id, text, internal_title, pillar, version, status")
    .eq("workspace_id", workspaceId).eq("telegram_job_id", jobId).maybeSingle();
  if (error) throw new Error("Could not recover the previously saved Telegram draft.");
  return data ?? null;
}

async function ensureInitialVersion(supabase: any, workspaceId: string, ownerUserId: string, jobId: string, post: any): Promise<void> {
  const { data: version, error: lookupError } = await supabase.from("content_post_versions")
    .select("id").eq("workspace_id", workspaceId).eq("telegram_job_id", jobId).maybeSingle();
  if (lookupError) throw new Error("Could not verify the saved draft version.");
  if (version) return;
  const { error } = await supabase.from("content_post_versions").insert({
    workspace_id: workspaceId, post_id: post.id, version_number: 1,
    text: post.text, change_source: "user_edit", changed_by: ownerUserId, telegram_job_id: jobId,
  });
  if (error && error.code !== "23505") throw new Error("Could not save the initial draft version.");
}

async function persistRevision(
  supabase: any,
  workspaceId: string,
  ownerUserId: string,
  jobId: string,
  existingPost: any,
  generated: { text: string; internalTitle: string }
): Promise<any> {
  const { data: priorVersion, error: versionLookupError } = await supabase.from("content_post_versions")
    .select("version_number, text").eq("workspace_id", workspaceId).eq("telegram_job_id", jobId).maybeSingle();
  if (versionLookupError) throw new Error("Could not recover the previous revision attempt.");

  let versionNumber: number;
  let revisionText: string;
  let title: string;
  if (priorVersion) {
    versionNumber = Number(priorVersion.version_number);
    revisionText = priorVersion.text;
    title = generated.internalTitle || existingPost.internal_title;
  } else {
    versionNumber = Number(existingPost.version || 1) + 1;
    revisionText = generated.text;
    title = generated.internalTitle || existingPost.internal_title;
    const { error: insertVersionError } = await supabase.from("content_post_versions").insert({
      workspace_id: workspaceId, post_id: existingPost.id, version_number: versionNumber,
      text: revisionText, change_source: "ai_revision", changed_by: ownerUserId, telegram_job_id: jobId,
    });
    if (insertVersionError && insertVersionError.code !== "23505") throw new Error("Could not save the revision version.");
  }

  const { data: current, error: currentError } = await supabase.from("content_posts")
    .select("id, text, internal_title, pillar, version, status")
    .eq("workspace_id", workspaceId).eq("id", existingPost.id).maybeSingle();
  if (currentError || !current || current.status !== "draft") throw new Error("The draft is no longer editable.");
  if (Number(current.version) < versionNumber) {
    const { data: updated, error: updateError } = await supabase.from("content_posts").update({
      text: revisionText, version: versionNumber, internal_title: title,
    }).eq("workspace_id", workspaceId).eq("id", existingPost.id)
      .eq("status", "draft").eq("version", Number(current.version))
      .select("id, text, internal_title, pillar, version, status").maybeSingle();
    if (updateError) throw new Error("Could not apply the saved revision.");
    if (updated) return updated;
    const { data: latest, error: latestError } = await supabase.from("content_posts")
      .select("id, text, internal_title, pillar, version, status")
      .eq("workspace_id", workspaceId).eq("id", existingPost.id).maybeSingle();
    if (latestError || !latest || Number(latest.version) < versionNumber) throw new Error("The draft changed during revision.");
    return latest;
  }
  return current;
}

function draftReply(post: any, revised: boolean): { text: string; markup?: any } {
  const title = escapeMarkdownV2(post.internal_title || "LinkedIn draft");
  const rawBody = post.text || "";
  let visibleBody = rawBody;
  while (visibleBody.length > 0 && escapeMarkdownV2(visibleBody).length > 3400) {
    visibleBody = visibleBody.slice(0, Math.max(0, visibleBody.length - 100));
  }
  const truncationNotice = visibleBody.length < rawBody.length
    ? "\n\n" + escapeMarkdownV2("[Open Nunuza to view the complete draft.]")
    : "";
  const body = escapeMarkdownV2(visibleBody) + truncationNotice;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  return {
    text:
      (revised ? "✏️ *Draft revised*\n\n" : "📝 *New draft created*\n\n") +
      "*" + title + "*\n\n" + body + "\n\n" +
      "Draft ID: " + post.id.slice(0, 8) + "\n" +
      escapeMarkdownV2("Saved in Nunuza as a draft. It has not been published.") + "\n\n" +
      escapeMarkdownV2("Use /drafts to review it. Publishing requires a separate approval action."),
    ...(appUrl ? { markup: { inline_keyboard: [[{ text: "Open full draft in Nunuza", url: appUrl + "/app/content" }]] } } : {}),
  };
}

export async function executeTelegramContentJob(job: AgentJob, supabase: any): Promise<JobExecutionResult> {
  const payload = job.payload as unknown as TelegramContentJobPayload;
  if (!payload || !Number.isSafeInteger(payload.telegramUserId) || !Number.isSafeInteger(payload.chatId) ||
      typeof payload.ownerUserId !== "string" || typeof payload.text !== "string" ||
      (payload.mode !== "new" && payload.mode !== "revision") || typeof payload.topic !== "string") {
    return { jobId: job.id, success: false, status: "failed_terminal", retryable: false, error: "Invalid Telegram content job payload." };
  }

  const { data: link, error: linkError } = await supabase.from("telegram_links")
    .select("conversation_state").eq("telegram_user_id", payload.telegramUserId)
    .eq("chat_id", payload.chatId).eq("workspace_id", job.workspace_id).is("revoked_at", null).maybeSingle();
  if (linkError) throw new Error("Could not verify the Telegram link for this content job.");
  if (!link) return { jobId: job.id, success: true, status: "succeeded", retryable: false };

  let state = readConversationState(link.conversation_state);
  if (state.pendingJobId !== job.id) {
    return { jobId: job.id, success: true, status: "succeeded", retryable: false };
  }

  const finishWithoutDraft = async (message: string, releaseReservation = false): Promise<JobExecutionResult> => {
    if (releaseReservation) {
      const { error } = await supabase.rpc("release_draft_usage", { p_job_id: job.id });
      if (error) throw new Error("Could not release unused draft usage reservation.");
    }
    await completeConversationJob(supabase, payload, job.workspace_id, job.id, stateWithoutPending(state));
    await sendConversationReply(payload.chatId, message);
    return { jobId: job.id, success: true, status: "succeeded", retryable: false };
  };

  try {
    let existingPost: any = null;
    if (payload.mode === "revision" && payload.activePostId) {
      const { data, error } = await supabase.from("content_posts")
        .select("id, text, internal_title, pillar, version, status")
        .eq("workspace_id", job.workspace_id).eq("id", payload.activePostId).maybeSingle();
      if (error) throw new Error("Could not load the active draft.");
      if (data?.status !== "draft") {
        return finishWithoutDraft("That draft is no longer editable. It may have been approved, rejected, or deleted. Use /drafts to review your posts.");
      }
      existingPost = data;
    }

    const [voiceResult, strategyResult, profileResult] = await Promise.all([
      supabase.from("voice_profiles").select("*").eq("workspace_id", job.workspace_id).maybeSingle(),
      supabase.from("content_strategies").select("*").eq("workspace_id", job.workspace_id).maybeSingle(),
      supabase.from("profiles").select("display_name").eq("id", payload.ownerUserId).maybeSingle(),
    ]);
    if (voiceResult.error || strategyResult.error || profileResult.error) throw new Error("Could not load workspace writing settings.");

    const voice = voiceResult.data;
    const strategy = strategyResult.data;
    const profile = profileResult.data;
    const voiceContext = voice ? {
      tone: voice.tone, sentenceLength: voice.sentence_length, formality: voice.formality,
      phrasesUse: voice.phrases_use, phrasesAvoid: voice.phrases_avoid,
      sampleText: voice.sample_text, exclusions: voice.exclusions,
    } : undefined;

    assertVoiceConstraints(payload.text, voiceContext);
    assertNoExcludedPhrase(payload.text, strategy?.exclusions, "content request");

    const { periodStart, periodEnd } = getCalendarMonthPeriod();
    if (!existingPost) {
      const { data: reserved, error: reserveError } = await supabase.rpc("reserve_draft_usage", {
        p_job_id: job.id, p_workspace_id: job.workspace_id,
        p_period_start: periodStart, p_period_end: periodEnd, p_limit: 30,
      });
      if (reserveError) throw new Error("Could not reserve your monthly draft allowance.");
      if (!reserved) return finishWithoutDraft("You've reached this workspace's monthly draft limit (30). It resets on the first day of next month. Your existing drafts are safe.");
    }

    let post = existingPost ? null : await loadExistingPostByJob(supabase, job.workspace_id, job.id);
    const topic = payload.mode === "revision"
      ? payload.topic
      : payload.topic.slice(0, 500);
    const targetLength = /\b(short|brief|concise|shorter)\b/i.test(payload.text)
      ? "short"
      : /\b(long|detailed|in-depth|deep dive|more detail)\b/i.test(payload.text)
        ? "long"
        : "medium";
    let generated: any = null;

    if (!post || existingPost) {
      generated = await aiService.generateDraft({
        topic,
        pillar: payload.pillar || undefined,
        notes: payload.mode === "new" && payload.text.length > 500 ? payload.text.slice(500, 2000) : undefined,
        targetLength,
        userRole: profile?.display_name ?? undefined,
        voiceProfile: voiceContext,
        strategy: strategy ? {
          audience: strategy.audience, goals: strategy.goals,
          pillars: Array.isArray(strategy.pillars) ? strategy.pillars.map((p: unknown) => typeof p === "string" ? p : JSON.stringify(p) ?? "") : undefined,
          exclusions: strategy.exclusions, ctaPreferences: strategy.cta_preferences,
        } : undefined,
        ...(existingPost ? { revision: { previousDraft: existingPost.text, instruction: payload.text } } : {}),
      });
      if (generated.providerUsed === "mock_deterministic") {
        return finishWithoutDraft("The AI providers are unavailable, so I couldn't generate a real draft. Please try again when Groq or OpenRouter is healthy. Nothing was saved.", !existingPost);
      }
      assertNoExcludedPhrase(generated.text, strategy?.exclusions, "generated draft");
      assertVoiceConstraints(generated.text, voiceContext);
    }

    if (existingPost) {
      post = await persistRevision(supabase, job.workspace_id, payload.ownerUserId, job.id, existingPost, generated);
    } else if (!post) {
      const { data, error } = await supabase.from("content_posts").insert({
        workspace_id: job.workspace_id,
        created_by: payload.ownerUserId,
        text: generated.text,
        internal_title: generated.internalTitle,
        pillar: generated.pillar ?? payload.pillar ?? null,
        source_notes: payload.text.slice(0, 2000),
        status: "draft",
        version: 1,
        telegram_job_id: job.id,
      }).select("id, text, internal_title, pillar, version, status").single();
      if (error?.code === "23505") {
        post = await loadExistingPostByJob(supabase, job.workspace_id, job.id);
      } else if (error || !data) {
        throw new Error("Could not save the generated draft.");
      } else {
        post = data;
      }
    }

    if (!post) throw new Error("Generated draft could not be recovered.");
    if (!existingPost) await ensureInitialVersion(supabase, job.workspace_id, payload.ownerUserId, job.id, post);

    const auditAction = existingPost ? "telegram_draft_revised" : "telegram_draft_created";
    const { data: priorAudit, error: auditLookupError } = await supabase.from("audit_events")
      .select("id").eq("workspace_id", job.workspace_id).eq("resource_id", post.id)
      .eq("action", auditAction).contains("safe_metadata", { telegramJobId: job.id }).maybeSingle();
    if (auditLookupError) throw new Error("Could not verify the content audit record.");
    if (!priorAudit) {
      const { error: auditError } = await supabase.from("audit_events").insert({
        workspace_id: job.workspace_id, actor_type: "telegram", actor_id: payload.ownerUserId,
        action: auditAction, resource_type: "content_post", resource_id: post.id,
        safe_metadata: { telegramJobId: job.id, providerUsed: generated?.providerUsed, modelUsed: generated?.modelUsed, estimatedTokens: generated?.estimatedTokens },
      });
      if (auditError) throw new Error("Could not record the content audit event.");
    }

    const nextState = safeStateFromPayload(payload, post.id, post.pillar);
    const completed = await completeConversationJob(supabase, payload, job.workspace_id, job.id, nextState);
    if (!completed) return { jobId: job.id, success: true, status: "succeeded", retryable: false };

    const reply = draftReply(post, Boolean(existingPost));
    await sendConversationReply(payload.chatId, reply.text, reply.markup);
    return { jobId: job.id, success: true, status: "succeeded", retryable: false };
  } catch (error) {
    if (error instanceof VoiceConstraintError || error instanceof StrategyExclusionError) {
      if (payload.mode === "new") {
        const { error: releaseError } = await supabase.rpc("release_draft_usage", { p_job_id: job.id });
        if (releaseError) throw new Error("Could not release unused draft usage reservation.");
      }
      const safeMessage = escapeMarkdownV2(error.message);
      await completeConversationJob(supabase, payload, job.workspace_id, job.id, stateWithoutPending(state));
      await sendConversationReply(payload.chatId, safeMessage);
      return { jobId: job.id, success: true, status: "succeeded", retryable: false };
    }

    if (job.attempt_count >= job.max_attempts) {
      await completeConversationJob(supabase, payload, job.workspace_id, job.id, stateWithoutPending(state));
      await sendConversationReply(payload.chatId, "I couldn't finish that content request after several attempts. Your existing draft is unchanged. Please retry or open /drafts.");
      return { jobId: job.id, success: false, status: "failed_terminal", retryable: false, error: "Telegram content job exhausted retries." };
    }
    throw error;
  }
}
