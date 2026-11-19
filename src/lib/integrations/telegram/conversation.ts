import crypto from "crypto";
import { classifyTelegramIntent } from "./intent";
import { routeTelegramMessage } from "@/lib/ai/chat-router";
import { aiService } from "@/lib/ai/service";
import { assertNoExcludedPhrase, StrategyExclusionError } from "@/lib/ai/exclusions";
import { assertVoiceConstraints, VoiceConstraintError } from "@/lib/ai/voice-constraints";
import { getDraftUsagePeriod } from "@/lib/db/usage";
import type { AgentJob } from "@/types/database";
import type { JobExecutionResult } from "@/lib/jobs/types";

type ConversationState = {
  activePostId?: string;
  topic?: string;
  pillar?: string;
  updatedAt?: string;
  pendingJobId?: string;
  pendingSince?: string;
  /** A vague message waiting for the user to confirm what to do with it. */
  proposedText?: string;
  /** The last chat exchange, so a follow-up like "yes, write it" has context. */
  lastUserText?: string;
  lastReply?: string;
  /** Set when the user tapped Request Changes on a specific draft. */
  focusedAt?: string;
};

type TelegramConversationInput = {
  telegramUserId: number;
  chatId: number;
  workspaceId: string;
  ownerUserId: string;
  updateId?: number;
  text: string;
  supabase: any;
  /** Set when the user tapped a button on a "what should I do with this?" prompt. */
  proposal?: "create" | "revise";
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

// Replies point to the drafts list with a button, never with a typed command.
const DRAFTS_BUTTON = { inline_keyboard: [[{ text: "📝 My Drafts", callback_data: "menu:drafts" }]] };

const WRITE_BUTTONS = {
  inline_keyboard: [
    [{ text: "✍️ Write a post", callback_data: "conversation:create" }],
    [{ text: "📝 My Drafts", callback_data: "menu:drafts" }, { text: "🏠 Main Menu", callback_data: "menu:main" }],
  ],
};
const DRAFT_CHAT_BUTTONS = {
  inline_keyboard: [
    [{ text: "📝 My Drafts", callback_data: "menu:drafts" }, { text: "✍️ Write a post", callback_data: "conversation:create" }],
    [{ text: "🏠 Main Menu", callback_data: "menu:main" }],
  ],
};

function chitchatReply(hasDraft: boolean): string {
  return escapeMarkdownV2(
    hasDraft
      ? "Hi! Your open draft is saved and unchanged. Tell me what to change, or tap Write a post for something new."
      : "Hi! I'm Nunuza, your LinkedIn content agent. Tell me what you'd like to post about, or tap Write a post."
  );
}

function questionReply(hasDraft: boolean): string {
  return escapeMarkdownV2(
    "I'm not a general chat assistant. I write, edit, schedule and publish your LinkedIn posts, and nothing is posted without your approval." +
    (hasDraft ? " To change your open draft, tell me what to change, for example: make it shorter." : " Tell me a topic or idea and I'll draft it.") +
    " Your drafts, schedule and settings are in the menu."
  );
}

function escapeMarkdownV2(value: string): string {
  return value.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

export function isRevisionRequest(text: string, hasActiveDraft: boolean): boolean {
  if (!hasActiveDraft) return false;
  const value = text.trim().toLocaleLowerCase();
  if (/^\/(new|cancel)\b/.test(value)) return false;
  // An active draft is the conversational context. Unless the user clearly
  // asks for a separate post/topic, treat follow-up language as a revision.
  // This avoids creating accidental extra drafts for requests like
  // "I don't like this opening" or "the example needs more detail".
  if (/\b(new post|another post|different topic|write (?:me )?(?:a )?(?:new )?(?:linkedin )?post|create (?:me )?(?:a )?(?:new )?(?:linkedin )?post|draft (?:a )?(?:new )?(?:linkedin )?post|generate (?:a )?(?:new )?(?:linkedin )?post|post about|write about|start a new post|start over)\b/.test(value)) {
    return false;
  }
  return true;
}

const FOCUS_WINDOW_MS = 60 * 60 * 1000;
const ACTIVE_DRAFT_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Picks the draft that a follow-up message refers to: the most recently
 * updated open draft of the workspace (within 48 hours), or the draft this chat
 * is already working on when that one is at least as recent.
 */
export async function resolveActiveDraftId(
  input: TelegramConversationInput,
  chatActiveId?: string,
  focusedAt?: string
): Promise<string | undefined> {
  try {
    // The draft the user explicitly chose with Request Changes wins for a while,
    // even when another draft is newer.
    if (chatActiveId && focusedAt && Date.now() - Date.parse(focusedAt) < FOCUS_WINDOW_MS) {
      const { data: focused } = await input.supabase.from("content_posts")
        .select("id, status").eq("workspace_id", input.workspaceId).eq("id", chatActiveId).maybeSingle();
      if (focused?.status === "draft") return chatActiveId;
    }
    const { data: latest } = await input.supabase.from("content_posts")
      .select("id, updated_at")
      .eq("workspace_id", input.workspaceId).eq("status", "draft")
      .gte("updated_at", new Date(Date.now() - ACTIVE_DRAFT_WINDOW_MS).toISOString())
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!latest?.id) return chatActiveId;
    if (!chatActiveId || chatActiveId === latest.id) return latest.id;
    const { data: current } = await input.supabase.from("content_posts")
      .select("id, updated_at, status")
      .eq("workspace_id", input.workspaceId).eq("id", chatActiveId).maybeSingle();
    if (current?.status === "draft" && Date.parse(current.updated_at) >= Date.parse(latest.updated_at)) return chatActiveId;
    return latest.id;
  } catch {
    return chatActiveId;
  }
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
    ...(typeof state.proposedText === "string" ? { proposedText: state.proposedText.slice(0, 1000) } : {}),
    ...(typeof state.lastUserText === "string" ? { lastUserText: state.lastUserText.slice(0, 300) } : {}),
    ...(typeof state.lastReply === "string" ? { lastReply: state.lastReply.slice(0, 400) } : {}),
    ...(typeof state.focusedAt === "string" ? { focusedAt: state.focusedAt } : {}),
  };
}

function stateWithoutPending(state: ConversationState): ConversationState {
  return {
    ...(state.activePostId ? { activePostId: state.activePostId } : {}),
    ...(state.topic ? { topic: state.topic } : {}),
    ...(state.pillar ? { pillar: state.pillar } : {}),
    ...(state.focusedAt ? { focusedAt: state.focusedAt } : {}),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Remembers which draft the user chose with Request Changes, so the next
 * message edits that draft and not whichever draft happens to be newest.
 * Best effort: when the chat is busy the newest-draft rule still applies.
 */
export async function focusDraftForRevision(
  supabase: any,
  target: { telegramUserId: number; chatId: number; workspaceId: string; postId: string }
): Promise<void> {
  try {
    const lockToken = crypto.randomUUID();
    const { data: claim } = await supabase.rpc("claim_telegram_conversation", {
      p_telegram_user_id: target.telegramUserId,
      p_chat_id: target.chatId,
      p_workspace_id: target.workspaceId,
      p_lock_token: lockToken,
    });
    if (!claim?.claimed) return;
    const prior = readConversationState(claim.state);
    const now = new Date().toISOString();
    await supabase.rpc("release_telegram_conversation", {
      p_telegram_user_id: target.telegramUserId,
      p_chat_id: target.chatId,
      p_workspace_id: target.workspaceId,
      p_lock_token: lockToken,
      p_state: { ...prior, activePostId: target.postId, focusedAt: now, updatedAt: now },
    });
  } catch {
    console.error("[telegram-conversation] Could not focus draft for revision.");
  }
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
      "Tell me the topic, point of view, audience, or rough idea. I'll queue a draft using your workspace strategy and voice profile, then send it here when it is ready.\n\n" +
      "Then ask me to revise it naturally, for example: _make the opening stronger_, _shorten it_, or _add a practical example_.\n\n" +
      "Your draft is saved in Nunuza. I never publish from a chat-generation request. Use /new to start another post. If a request is stuck before it starts, use /cancel to clear it and try again.",
  };
}

export async function handleTelegramConversation(input: TelegramConversationInput): Promise<TelegramConversationResult> {
  let text = input.text.trim();
  if (!text && !input.proposal) return { replyText: "Tell me what you want your LinkedIn post to be about." };
  if (text.length > 4000) return { replyText: "That message is too long. Keep a content request under 4,000 characters and send it again." };
  if (!input.proposal && (text === "/help" || (text.startsWith("/") && text !== "/new" && text !== "/cancel"))) return helpReply();

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
    // A queued job can be stranded when the worker is unavailable. Allow the
    // owner to cancel only work that has not started; never cancel a running
    // generation because it may already be producing or persisting a draft.
    if (text === "/cancel") {
      if (state.pendingJobId) {
        const { data: pendingJob, error: pendingError } = await input.supabase.from("agent_jobs")
          .select("id, status").eq("id", state.pendingJobId).eq("workspace_id", input.workspaceId).maybeSingle();
        if (pendingError) throw new Error("Could not verify the pending content request.");
        if (pendingJob?.status === "running") {
          await releaseConversation(input, lockToken, state);
          return { replyText: "Your post has already started, so I can't safely cancel it. I'll send the draft here when it's ready." };
        }
        if (pendingJob && ["queued", "failed_retryable"].includes(pendingJob.status)) {
          const { error: cancelError } = await input.supabase.from("agent_jobs")
            .update({
              status: "canceled",
              finished_at: new Date().toISOString(),
              lease_until: null,
              last_error_code: "USER_CANCELED",
              safe_error_message: "This request was canceled by the user before generation started.",
              updated_at: new Date().toISOString(),
            })
            .eq("id", state.pendingJobId)
            .eq("workspace_id", input.workspaceId)
            .in("status", ["queued", "failed_retryable"]);
          if (cancelError) throw new Error("Could not cancel the pending content request.");
        }
      }
      await releaseConversation(input, lockToken, stateWithoutPending(state));
      return { replyText: "Cancelled the request that had not started. Your existing drafts are unchanged. Send a new post idea whenever you're ready." };
    }

    if (text === "/new" && state.pendingJobId) {
      await releaseConversation(input, lockToken, state);
      return { replyText: "Your previous post is still in progress. If it has not started, send /cancel first; then you can start a new post." };
    }

    if (state.pendingJobId) {
      const { data: pendingJob, error: pendingError } = await input.supabase.from("agent_jobs")
        .select("id, status").eq("id", state.pendingJobId).eq("workspace_id", input.workspaceId).maybeSingle();
      if (pendingError) throw new Error("Could not verify the pending content request.");
      if (pendingJob && ["queued", "running", "failed_retryable"].includes(pendingJob.status)) {
        await releaseConversation(input, lockToken, state);
        if (pendingJob.status === "queued") {
          return { replyText: "Your previous request is saved, but post generation has not started because the background worker has not picked it up yet. Nothing is being generated right now. Send /cancel to clear this request, or wait until the worker is available." };
        }
        if (pendingJob.status === "failed_retryable") {
          return { replyText: "Your previous post hit a temporary issue and is waiting to retry. I'll update you when it finishes." };
        }
        return { replyText: "I'm still creating your previous post. I'll send the draft here when it's ready." };
      }
      if (pendingJob?.status === "succeeded" && state.activePostId) {
        await releaseConversation(input, lockToken, stateWithoutPending(state));
        return { replyText: "Your previous draft is ready. Tap My Drafts to review it, or send a new post idea.", replyMarkup: DRAFTS_BUTTON };
      }
      state = stateWithoutPending(state);
    }

    if (text === "/new") {
      await releaseConversation(input, lockToken, {});
      return { replyText: "Ready for a new post. Tell me what you want to write about." };
    }

    // The draft being discussed is the newest open draft in the workspace, not
    // only one created in this chat. Drafts made on the web, by the daily agent
    // or through MCP arrive here as an image, and "make it shorter" must edit
    // that draft instead of starting a new post about "make it shorter".
    const activePostId = await resolveActiveDraftId(input, state.activePostId, state.focusedAt);

    // Work out what the message means before generating anything. Only a clear
    // request (or a button the user tapped) creates or edits a draft.
    let intent: "create" | "revise" | "chitchat" | "question" | "vague";
    if (input.proposal) {
      const proposed = state.proposedText;
      if (!proposed) {
        await releaseConversation(input, lockToken, stateWithoutPending(state));
        return { replyText: "That suggestion expired. Send your idea again.", replyMarkup: WRITE_BUTTONS };
      }
      text = proposed;
      intent = input.proposal === "revise" && activePostId ? "revise" : "create";
    } else {
      // Ask the AI what the user means, like a chat assistant. If it is
      // unavailable, fall back to the keyword classifier so the bot still
      // answers instead of drafting on a guess.
      let draftText: string | undefined;
      if (activePostId) {
        try {
          const { data: openDraft } = await input.supabase.from("content_posts")
            .select("text").eq("workspace_id", input.workspaceId).eq("id", activePostId).maybeSingle();
          draftText = typeof openDraft?.text === "string" ? openDraft.text : undefined;
        } catch {
          draftText = undefined;
        }
      }
      const routed = await routeTelegramMessage({
        text,
        draftText,
        lastUserText: state.lastUserText,
        lastReply: state.lastReply,
      });
      if (routed?.intent === "chat") {
        await releaseConversation(input, lockToken, {
          ...stateWithoutPending(state),
          lastUserText: text.slice(0, 300),
          lastReply: routed.reply.slice(0, 400),
        });
        return {
          replyText: escapeMarkdownV2(routed.reply),
          replyMarkup: activePostId ? DRAFT_CHAT_BUTTONS : WRITE_BUTTONS,
        };
      }
      if (routed) {
        intent = routed.intent;
        if (routed.intent === "create" && routed.topic) text = routed.topic;
      } else {
        intent = classifyTelegramIntent(text, Boolean(activePostId));
      }
    }

    if (intent === "chitchat" || intent === "question") {
      await releaseConversation(input, lockToken, stateWithoutPending(state));
      return {
        replyText: intent === "chitchat" ? chitchatReply(Boolean(activePostId)) : questionReply(Boolean(activePostId)),
        replyMarkup: activePostId ? DRAFT_CHAT_BUTTONS : WRITE_BUTTONS,
      };
    }

    if (intent === "vague") {
      await releaseConversation(input, lockToken, { ...stateWithoutPending(state), proposedText: text.slice(0, 1000) });
      const preview = text.length > 90 ? text.slice(0, 87) + "..." : text;
      return {
        replyText: escapeMarkdownV2("Do you want me to write a LinkedIn post from this?") + "\n\n_" + escapeMarkdownV2(preview) + "_",
        replyMarkup: {
          inline_keyboard: [
            [{ text: "✍️ Write a post", callback_data: "chat:propose:create" }],
            ...(activePostId ? [[{ text: "✏️ Edit my open draft", callback_data: "chat:propose:revise" }]] : []),
            [{ text: "Not now", callback_data: "chat:dismiss" }],
          ],
        },
      };
    }

    const isRevision = intent === "revise";
    let existingPost: any = null;
    if (isRevision && activePostId) {
      const { data, error } = await input.supabase.from("content_posts")
        .select("id, text, internal_title, pillar, version, status")
        .eq("workspace_id", input.workspaceId).eq("id", activePostId).maybeSingle();
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
      ...(existingPost ? { activePostId: existingPost.id } : state.activePostId ? { activePostId: state.activePostId } : {}),
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
        return { replyText: "That request has already completed. Tap My Drafts to find the saved post.", replyMarkup: DRAFTS_BUTTON };
      }
      if (enqueueResult?.reason === "previous_failed") {
        return { replyText: "Your previous attempt failed. Send the content request again to retry it." };
      }
      return { replyText: "Your content session changed while I was queueing that request. Please send it again." };
    }

    return {
      replyText:
        "📥 Your LinkedIn post request is saved in the queue. Generation has not started yet; the background worker must pick it up first.\n\n" +
        "I'll send the draft here as an image after generation actually starts and finishes. Send /cancel if you want to clear a request that has not started.\n\n" +
        "Nothing is published by this request.",
      replyMarkup: DRAFTS_BUTTON,
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


export async function executeTelegramContentJob(
  job: AgentJob,
  supabase: any,
  browserBinding?: {
    quickAction(
      action: "screenshot",
      options: {
        url: string;
        viewport?: { width: number; height: number };
        screenshotOptions?: { fullPage?: boolean };
        gotoOptions?: { waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2"; timeout?: number };
      }
    ): Promise<Response>;
  }
): Promise<JobExecutionResult> {
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
    await sendConversationReply(payload.chatId, message, DRAFTS_BUTTON);
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
        return finishWithoutDraft("That draft is no longer editable. It may have been approved, rejected, or deleted. Tap My Drafts to review your posts.");
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

    const quotaPeriod = !existingPost
      ? await getDraftUsagePeriod(job.workspace_id, payload.ownerUserId, supabase)
      : null;
    if (!existingPost && quotaPeriod) {
      const { data: reserved, error: reserveError } = await supabase.rpc("reserve_draft_usage", {
        p_job_id: job.id,
        p_workspace_id: job.workspace_id,
        p_period_start: quotaPeriod.periodStart,
        p_period_end: quotaPeriod.periodEnd,
        p_limit: 30,
        p_metric: quotaPeriod.metric,
      });
      if (reserveError) throw new Error("Could not reserve your monthly draft allowance.");
      if (!reserved) return finishWithoutDraft(`You've reached this workspace's monthly draft limit (30). It resets on ${quotaPeriod.resetsOn}. Your existing drafts are safe.`);
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

    // Deliver the actual Telegram photo before clearing the pending job state.
    // If rendering or upload fails, let the durable job retry the delivery path;
    // the draft is already persisted and is recovered by telegram_job_id.
    const { sendTelegramDraftPreview } = await import("./service");
    const previewDelivery = await sendTelegramDraftPreview(
      payload.chatId,
      post,
      Boolean(existingPost),
      browserBinding
    );
    if (!previewDelivery.ok) {
      throw new Error("Telegram draft image delivery failed.");
    }

    const nextState = safeStateFromPayload(payload, post.id, post.pillar);
    try {
      const completed = await completeConversationJob(supabase, payload, job.workspace_id, job.id, nextState);
      if (!completed) {
        console.warn("[telegram-conversation] Draft image was delivered but the conversation state had already changed.");
      }
    } catch (stateError) {
      // Telegram has confirmed delivery. Do not retry the whole job and send a
      // duplicate photo solely because conversation cleanup had a DB hiccup.
      console.error("[telegram-conversation] Photo delivered; conversation cleanup needs repair:", stateError instanceof Error ? stateError.message : "database_error");
    }
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
      // A draft may already be committed even though its Telegram photo failed.
      // Preserve that draft and its usage reservation; only release usage when
      // generation never persisted a post.
      const savedPost = await loadExistingPostByJob(supabase, job.workspace_id, job.id);
      if (payload.mode === "new" && !savedPost) {
        const { error: releaseError } = await supabase.rpc("release_draft_usage", { p_job_id: job.id });
        if (releaseError) throw new Error("Could not release unused draft usage reservation.");
      }
      // The agent_jobs status trigger creates the durable user-facing failure
      // notification. Do not send a second direct Telegram message here.
      await completeConversationJob(supabase, payload, job.workspace_id, job.id, stateWithoutPending(state));
      return { jobId: job.id, success: false, status: "failed_terminal", retryable: false, error: "Telegram content job exhausted retries." };
    }
    throw error;
  }
}
