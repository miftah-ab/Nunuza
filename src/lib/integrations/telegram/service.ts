/**
 * Telegram Bot Integration Service.
 *
 * Implements:
 * 1. Cryptographically secure pairing token generation (link_tokens).
 * 2. Account linking & unlinking bound to authenticated workspaces (telegram_links).
 * 3. Webhook secret validation and replay protection (update_id deduplication).
 * 4. Conversational command processing:
 *    /start, /status, /pause, /resume, /drafts, /report, /help, /settings (approve/reject are buttons, never typed IDs)
 * 5. Inline keyboard menus and callback_query handling.
 * 6. Bot command registration via setMyCommands.
 * 7. Strict adherence to spec:
 *    - Approval cannot be bypassed.
 *    - draft_only entitlement rejects publishing/approval with clear explanation.
 *    - Cross-tenant isolation enforced on every action.
 *    - Fail-closed message delivery.
 */

import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { handleTelegramConversation } from "./conversation";
import { getDraftUsagePeriod } from "@/lib/db/usage";
import { escapeMd } from "./markdown";
import { scheduleApprovedPost, cancelScheduledPostByAgent, formatScheduledTime, APPROVAL_LEAD_MS } from "@/lib/jobs/agent-scheduling";
import { getRequestBrowserBinding, type TelegramBrowserBinding } from "./runtime";

export type { TelegramBrowserBinding } from "./runtime";

// ─── Durable webhook idempotency ──────────────────────────────────────────────

export type TelegramUpdateClaim = "claimed" | "completed" | "processing";

export async function claimTelegramWebhookUpdate(updateId: number, supabaseOverride?: any): Promise<TelegramUpdateClaim> {
  const supabase = supabaseOverride || createServiceClient();
  const { data, error } = await supabase.rpc("claim_telegram_webhook_update", { p_update_id: updateId });
  if (error) throw new Error("Could not claim Telegram update.");
  if (data !== "claimed" && data !== "completed" && data !== "processing") throw new Error("Invalid Telegram update claim state.");
  return data;
}
export async function completeTelegramWebhookUpdate(updateId: number, supabaseOverride?: any): Promise<void> {
  const supabase = supabaseOverride || createServiceClient();
  const { error } = await supabase.rpc("complete_telegram_webhook_update", { p_update_id: updateId });
  if (error) throw new Error("Could not complete Telegram update.");
}
export async function failTelegramWebhookUpdate(updateId: number, supabaseOverride?: any): Promise<void> {
  const supabase = supabaseOverride || createServiceClient();
  const { error } = await supabase.rpc("fail_telegram_webhook_update", { p_update_id: updateId });
  if (error) throw new Error("Could not release Telegram update for retry.");
}

// ─── Secret & Webhook Validation ──────────────────────────────────────────────

export function verifyTelegramSecret(headerSecret: string | null | undefined): boolean {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return process.env.NODE_ENV === "test";
  }
  if (!headerSecret) return false;

  try {
    const a = Buffer.from(headerSecret);
    const b = Buffer.from(expectedSecret);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── MarkdownV2 Escaping ──────────────────────────────────────────────────────


// ─── Telegram API Helpers ─────────────────────────────────────────────────────

const TG_API = (token: string, method: string) =>
  `https://api.telegram.org/bot${token}/${method}`;

async function tgPost(method: string, body: object): Promise<any> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.trim() === "") return { ok: false, error: "Telegram bot is not configured." };
  try {
    const res = await fetch(TG_API(token, method), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    const result: any = await res.json();
    if (!res.ok || !result?.ok) return { ok: false, error: result?.description || `Telegram API returned HTTP ${res.status}.` };
    return result;
  } catch (err: any) {
    console.error(`[telegram] ${method} request failed:`, err?.name || "UnknownError");
    return { ok: false, error: "Telegram API request failed." };
  }
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<void> {
  await tgPost("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text, show_alert: false } : {}),
  });
}

export async function editTelegramMessage(
  chatId: number,
  messageId: number,
  text: string,
  replyMarkup?: any
): Promise<void> {
  const payload: any = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "MarkdownV2",
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  const result = await tgPost("editMessageText", payload);
  if (!result.ok && result.error?.toLowerCase().includes("there is no text in the message to edit")) {
    // Draft previews are photo messages, so Telegram requires editMessageCaption.
    const captionPayload: any = {
      chat_id: chatId,
      message_id: messageId,
      caption: text.slice(0, 1024),
      parse_mode: "MarkdownV2",
    };
    if (replyMarkup) captionPayload.reply_markup = replyMarkup;
    const captionResult = await tgPost("editMessageCaption", captionPayload);
    if (!captionResult.ok && captionResult.error?.includes("can't parse entities")) {
      delete captionPayload.parse_mode;
      captionPayload.caption = text.replace(/\\/g, "").slice(0, 1024);
      await tgPost("editMessageCaption", captionPayload);
    }
    return;
  }
  if (!result.ok && result.error?.includes("can't parse entities")) {
    // Fallback: try without parse_mode
    const plainPayload: any = { chat_id: chatId, message_id: messageId, text: text.replace(/\\/g, "") };
    if (replyMarkup) plainPayload.reply_markup = replyMarkup;
    await tgPost("editMessageText", plainPayload);
  }
}

// ─── Keyboard Builders ────────────────────────────────────────────────────────

function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "✍️ Create a Post", callback_data: "conversation:create" }],
      [
        { text: "📝 My Drafts", callback_data: "menu:drafts" },
        { text: "✅ Approvals", callback_data: "menu:approvals" },
      ],
      [
        { text: "📅 Schedule", callback_data: "menu:schedule" },
        { text: "📊 Usage & Limits", callback_data: "menu:performance" },
      ],
      [
        { text: "🤖 Agent Status", callback_data: "menu:agent" },
        { text: "⚙️ Settings", callback_data: "menu:settings" },
      ],
      [{ text: "❓ Help", callback_data: "menu:help" }],
    ],
  };
}

function navRow(backData = "menu:main") {
  return [
    { text: "⬅️ Back", callback_data: backData },
    { text: "🏠 Main Menu", callback_data: "menu:main" },
  ];
}

// ─── Draft lists (buttons only: no IDs, no typed commands) ────────────────────

const DRAFT_PAGE_SIZE = 5;

function draftLabel(draft: { internal_title?: string | null }): string {
  // Never fall back to the post body: draft text is shown only in the image preview.
  return (draft.internal_title || "Untitled draft").slice(0, 50);
}

async function buildDraftList(
  supabase: any,
  workspaceId: string,
  statuses: string[],
  offset: number
): Promise<{ text: string; markup: any }> {
  const { data: drafts, error } = await supabase
    .from("content_posts")
    .select("id, internal_title, status, created_at")
    .eq("workspace_id", workspaceId)
    .in("status", statuses)
    .order("created_at", { ascending: false })
    .range(offset, offset + DRAFT_PAGE_SIZE - 1);

  if (error) {
    return { text: "❌ *Could not load drafts\\.* Please retry\\.", markup: { inline_keyboard: [navRow()] } };
  }
  if (!drafts || drafts.length === 0) {
    return {
      text: "📝 *No drafts awaiting review\\.*\n\nYour review queue is currently clear\\.",
      markup: { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "menu:main" }]] },
    };
  }

  let text = `📝 *Drafts \\(showing ${offset + 1}\\-${offset + drafts.length}\\)*\n\nTap *View* to see a draft as an image, then approve, reject or ask for changes\\.\n\n`;
  const buttons: any[] = [];
  drafts.forEach((d: any, idx: number) => {
    const statusEmoji = d.status === "needs_review" ? "🔍" : "📄";
    text += `${offset + idx + 1}\\. ${statusEmoji} *${escapeMd(draftLabel(d))}*\n`;
    buttons.push([
      { text: `👁 View #${offset + idx + 1}`, callback_data: `draft:view:${d.id}` },
      { text: "✅ Approve", callback_data: `draft:approve:${d.id}` },
      { text: "❌ Reject", callback_data: `draft:reject:${d.id}` },
    ]);
  });

  const pagination: any[] = [];
  if (offset > 0) pagination.push({ text: "⬅️ Prev", callback_data: `draft:prev:${Math.max(0, offset - DRAFT_PAGE_SIZE)}` });
  if (drafts.length === DRAFT_PAGE_SIZE) pagination.push({ text: "Next ➡️", callback_data: `draft:next:${offset + DRAFT_PAGE_SIZE}` });
  if (pagination.length > 0) buttons.push(pagination);
  buttons.push([{ text: "🏠 Main Menu", callback_data: "menu:main" }]);

  return { text: text.trim(), markup: { inline_keyboard: buttons } };
}

async function loadPostTitle(supabase: any, workspaceId: string, postId: string): Promise<string> {
  const { data } = await supabase
    .from("content_posts")
    .select("internal_title")
    .eq("id", postId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return draftLabel(data ?? {});
}

// ─── Pairing Tokens ───────────────────────────────────────────────────────────

export interface PairingTokenResult {
  token: string;
  botUrl: string | null;
  expiresAt: string;
}

export async function generateTelegramPairingToken(
  workspaceId: string,
  userId: string,
  supabaseOverride?: any
): Promise<PairingTokenResult> {
  const rawToken = crypto.randomBytes(24).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const supabase = supabaseOverride || createServiceClient();

  const { error } = await supabase.from("link_tokens").insert({
    workspace_id: workspaceId,
    user_id: userId,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  if (error) {
    throw new Error(`Failed to create pairing token: ${error.message}`);
  }

  const botUsername =
    process.env.TELEGRAM_BOT_USERNAME ||
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ||
    "NunuzaBot";
  const botUrl = `https://t.me/${botUsername}?start=${rawToken}`;

  return { token: rawToken, botUrl, expiresAt };
}

export async function linkTelegramAccount(rawToken: string, telegramUserId: number, chatId: number, supabaseOverride?: any): Promise<{ success: boolean; workspaceId?: string; error?: string }> {
  if (!rawToken || rawToken.length > 256 || !Number.isSafeInteger(telegramUserId) || !Number.isSafeInteger(chatId)) return { success: false, error: "Invalid pairing request." };
  const tokenHash = crypto.createHash("sha256").update(rawToken.trim()).digest("hex");
  const supabase = supabaseOverride || createServiceClient();
  const { data, error } = await supabase.rpc("link_telegram_account", { p_token_hash: tokenHash, p_telegram_user_id: telegramUserId, p_chat_id: chatId });
  if (error || !data) {
    console.warn("[telegram] Account pairing failed:", error?.code || "invalid_or_expired_token");
    return { success: false, error: "Invalid, expired, or already used pairing token. Please generate a new one from your Nunuza dashboard." };
  }
  return { success: true, workspaceId: data };
}

export async function unlinkTelegramAccount(
  workspaceId: string,
  supabaseOverride?: any
): Promise<boolean> {
  const supabase = supabaseOverride || createServiceClient();
  const { error } = await supabase
    .from("telegram_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null);

  if (!error) {
    await supabase.from("audit_events").insert({
      workspace_id: workspaceId,
      actor_type: "user",
      action: "telegram_unlinked",
      resource_type: "telegram_link",
      safe_metadata: {},
    });
    return true;
  }
  return false;
}

export async function getTelegramLinkStatus(
  workspaceId: string,
  supabaseOverride?: any
): Promise<{
  linked: boolean;
  telegramUserId?: number;
  chatId?: number;
  linkedAt?: string;
  lastInteractionAt?: string;
}> {
  const supabase = supabaseOverride || createServiceClient();
  const { data, error } = await supabase
    .from("telegram_links")
    .select("telegram_user_id, chat_id, linked_at, last_interaction_at")
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !data) {
    return { linked: false };
  }

  return {
    linked: true,
    telegramUserId: data.telegram_user_id,
    chatId: data.chat_id,
    linkedAt: data.linked_at,
    lastInteractionAt: data.last_interaction_at,
  };
}

// ─── Command Handling ─────────────────────────────────────────────────────────

export interface CommandContext {
  telegramUserId: number; chatId: number; text: string; chatType?: string; updateId?: number;
}

export interface CommandResponse {
  replyText: string;
  replyMarkup?: any;
}

/** Resolve active workspace for a Telegram user; returns null if unlinked. */
async function resolveWorkspace(
  telegramUserId: number, chatId: number, supabase: any
): Promise<{ workspaceId: string; workspace: any } | null> {
  const { data: link, error: linkErr } = await supabase
    .from("telegram_links").select("workspace_id, chat_id")
    .eq("telegram_user_id", telegramUserId).eq("chat_id", chatId)
    .is("revoked_at", null).maybeSingle();

  if (linkErr || !link) return null;

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id, owner_user_id, name, entitlement_type, state, operating_mode, paused_at")
    .eq("id", link.workspace_id)
    .single();

  if (workspaceError || !workspace) return null;
  return { workspaceId: link.workspace_id, workspace };
}

function canPublishEntitlement(entitlement: string): boolean {
  return ["internal_beta", "publishing_beta", "internal_test", "paid_trial", "paid_active"].includes(entitlement);
}

function notLinkedResponse(appUrl: string): CommandResponse {
  return {
    replyText:
      "👋 **Welcome to Nunuza!**\n\n" +
      "🔒 **Nunuza Account Not Linked**\n\n" +
      "Connect your Nunuza workspace from the web dashboard:\n\n" +
      "1. Open your Nunuza dashboard\n" +
      "2. Go to **Integrations**\n" +
      "3. Click **Connect Telegram**",
    replyMarkup: {
      inline_keyboard: [
        [{ text: "🌐 Open Nunuza Dashboard", url: `${appUrl}/app/integrations` }],
      ],
    },
  };
}

export async function handleTelegramMessage(
  ctx: CommandContext,
  supabaseOverride?: any
): Promise<CommandResponse> {
  const supabase = supabaseOverride || createServiceClient();
  const text = (ctx.text || "").trim();
  if (ctx.chatType && ctx.chatType !== "private") return { replyText: "🔒 Nunuza commands are available only in your private chat with the bot." };
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // 1. /start with deep-link token
  if (text.startsWith("/start")) {
    const parts = text.split(" ");
    if (parts.length > 1 && parts[1].trim()) {
      const token = parts[1].trim();
      const linkResult = await linkTelegramAccount(token, ctx.telegramUserId, ctx.chatId, supabase);
      if (linkResult.success) {
        return {
          replyText:
            "🎉 *Account linked successfully\\!*\n\n" +
            "Your Telegram account is now connected to your Nunuza workspace\\.\n\n" +
            "Use the menu below to get started:",
          replyMarkup: mainMenuKeyboard(),
        };
      } else {
        return {
          replyText: `❌ ${escapeMd(linkResult.error || "Failed to link account.")}`,
        };
      }
    }
  }

  // 2. Resolve workspace
  const resolved = await resolveWorkspace(ctx.telegramUserId, ctx.chatId, supabase);

  if (!resolved) {
    return notLinkedResponse(appUrl);
  }

  const { workspaceId, workspace } = resolved;
  const entitlement = workspace?.entitlement_type || "draft_only";

  // Update last interaction
  await supabase
    .from("telegram_links")
    .update({ last_interaction_at: new Date().toISOString() })
    .eq("telegram_user_id", ctx.telegramUserId)
    .eq("chat_id", ctx.chatId)
    .is("revoked_at", null);

  // 3. Dispatch commands
  if (text.startsWith("/start") || text === "/help" || text === "/settings") {
    if (text === "/settings") {
      return {
        replyText:
          `⚙️ *Settings \\— ${escapeMd(workspace?.name || "Workspace")}*\n\n` +
          `• Entitlement: \`${escapeMd(entitlement)}\`\n` +
          `• Mode: \`${escapeMd(workspace?.operating_mode || "approval_required")}\`\n\n` +
          `Manage account settings in your dashboard:`,
        replyMarkup: {
          inline_keyboard: [
            [{ text: "🌐 Open Settings", url: `${appUrl}/app/settings` }],
            [{ text: "🏠 Main Menu", callback_data: "menu:main" }],
          ],
        },
      };
    }
    return {
      replyText:
        `🤖 *Nunuza Agent* — ${escapeMd(workspace?.name || "Workspace")}\n\n` +
        `Send me a message describing the LinkedIn post you want. I can create and revise drafts in your voice.\n\nUse the menu below to manage your LinkedIn content:`,
      replyMarkup: mainMenuKeyboard(),
    };
  }

  if (text === "/status") {
    const { count: draftCount } = await supabase
      .from("content_posts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "draft");

    const { count: reviewCount } = await supabase
      .from("content_posts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "needs_review");

    const { count: scheduledCount } = await supabase
      .from("content_posts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "scheduled");

    const isPaused = !!workspace?.paused_at;
    const modeLabel = workspace?.operating_mode === "autopilot" ? "Autopilot" : "Approval Required";

    return {
      replyText:
        `📊 *Workspace Status*\n\n` +
        `• *Workspace:* ${escapeMd(workspace?.name || "Solo")}\n` +
        `• *Agent:* ${isPaused ? "⏸️ Paused" : "▶️ Active"}\n` +
        `• *Mode:* ${escapeMd(modeLabel)}\n` +
        `• *Entitlement:* \`${escapeMd(entitlement)}\`\n` +
        `• *Drafts:* ${(draftCount ?? 0) + (reviewCount ?? 0)}\n` +
        `• *Scheduled:* ${scheduledCount ?? 0}` +
        (!canPublishEntitlement(entitlement)
          ? "\n\n⚠️ _Subscription required for publishing_"
          : ""),
      replyMarkup: {
        inline_keyboard: [
          [
            { text: isPaused ? "▶️ Resume" : "⏸️ Pause", callback_data: isPaused ? "agent:resume" : "agent:pause" },
          ],
          [{ text: "🏠 Main Menu", callback_data: "menu:main" }],
        ],
      },
    };
  }

  if (text === "/pause") {
    const { error: pauseError } = await supabase
      .from("workspaces")
      .update({ paused_at: new Date().toISOString(), state: "paused" })
      .eq("id", workspaceId);
    if (pauseError) return { replyText: "❌ I couldn't pause the agent because the workspace update failed. Please retry." };

    const { error: pauseAuditError } = await supabase.from("audit_events").insert({
      workspace_id: workspaceId,
      actor_type: "telegram",
      action: "agent_paused",
      resource_type: "workspace",
      resource_id: workspaceId,
      safe_metadata: { source: "telegram_command" },
    });
    if (pauseAuditError) console.error("[telegram] Pause audit write failed:", pauseAuditError.code || "database_error");

    return {
      replyText: "⏸️ *Agent Paused*\n\nAutonomous operations are paused\\. Tap Resume to reactivate\\.",
      replyMarkup: {
        inline_keyboard: [
          [{ text: "▶️ Resume", callback_data: "agent:resume" }],
          [{ text: "🏠 Main Menu", callback_data: "menu:main" }],
        ],
      },
    };
  }

  if (text === "/resume") {
    const { error: resumeError } = await supabase
      .from("workspaces")
      .update({
        paused_at: null,
        state: workspace?.operating_mode === "autopilot" ? "active_autopilot" : "active_approval_required",
      })
      .eq("id", workspaceId);
    if (resumeError) return { replyText: "❌ I couldn't resume the agent because the workspace update failed. Please retry." };

    const { error: resumeAuditError } = await supabase.from("audit_events").insert({
      workspace_id: workspaceId,
      actor_type: "telegram",
      action: "agent_resumed",
      resource_type: "workspace",
      resource_id: workspaceId,
      safe_metadata: { source: "telegram_command" },
    });
    if (resumeAuditError) console.error("[telegram] Resume audit write failed:", resumeAuditError.code || "database_error");

    return {
      replyText: "▶️ *Agent Resumed*\n\nAutonomous operations are now active\\.",
      replyMarkup: {
        inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "menu:main" }]],
      },
    };
  }

  if (text === "/drafts" || text.startsWith("/approve") || text.startsWith("/reject")) {
    // Approving and rejecting happen with the buttons on each draft. Nobody
    // has to type or copy a draft ID, so the old typed forms show the same list.
    const list = await buildDraftList(supabase, workspaceId, ["draft", "needs_review"], 0);
    return { replyText: list.text, replyMarkup: list.markup };
  }

  if (text === "/report") {
    const now = new Date();
    const currentPeriod = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);

    const { data: usage } = await supabase
      .from("usage_counters")
      .select("count")
      .eq("workspace_id", workspaceId)
      .eq("metric", "draft_items_created")
      .eq("period_start", periodStart)
      .maybeSingle();

    const used = usage?.count ?? 0;

    return {
      replyText:
        `📈 *Monthly Workflow Report*\n\n` +
        `• *Period:* ${escapeMd(currentPeriod)} \\(UTC\\)\n` +
        `• *Generated Drafts:* ${used} / 30 limit\n` +
        `• *Daily Cap:* Max 1 post/day\n` +
        `• *Weekly Cap:* Max 7 posts/week\n` +
        `• *Reset:* 1st of next month`,
      replyMarkup: {
        inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "menu:main" }]],
      },
    };
  }

  // Natural-language content requests reuse the workspace AI and draft pipeline.
  return handleTelegramConversation({
    telegramUserId: ctx.telegramUserId,
    chatId: ctx.chatId,
    workspaceId,
    ownerUserId: workspace.owner_user_id,
    updateId: ctx.updateId,
    text,
    supabase,
  });
}

// ─── Callback Query Handler ───────────────────────────────────────────────────

export interface CallbackContext {
  callbackQueryId: string; telegramUserId: number; chatId: number; messageId: number; data: string; chatType?: string;
}

export async function handleCallbackQuery(
  ctx: CallbackContext,
  supabaseOverride?: any
): Promise<void> {
  const supabase = supabaseOverride || createServiceClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // Dismiss the Telegram spinner immediately; this acknowledgement exposes no workspace data.
  if (ctx.chatType && ctx.chatType !== "private") {
    await answerCallbackQuery(ctx.callbackQueryId, "Use Nunuza in your private chat.");
    return;
  }
  await answerCallbackQuery(ctx.callbackQueryId);
  const resolved = await resolveWorkspace(ctx.telegramUserId, ctx.chatId, supabase);

  if (!resolved) {
    await editTelegramMessage(
      ctx.chatId,
      ctx.messageId,
      "🔒 *Account not linked\\.* Please connect your Nunuza workspace from the dashboard\\.",
      {
        inline_keyboard: [
          [{ text: "🌐 Open Dashboard", url: `${appUrl}/app/integrations` }],
        ],
      }
    );
    return;
  }

  const { workspaceId, workspace } = resolved;
  const entitlement = workspace?.entitlement_type || "draft_only";
  const data = ctx.data || "";

  // Update last interaction timestamp
  await supabase
    .from("telegram_links")
    .update({ last_interaction_at: new Date().toISOString() })
    .eq("telegram_user_id", ctx.telegramUserId)
    .eq("chat_id", ctx.chatId)
    .is("revoked_at", null);

  // ── Main Menu ──
  if (data === "menu:main") {
    await editTelegramMessage(
      ctx.chatId,
      ctx.messageId,
      `🤖 *Nunuza Agent* — ${escapeMd(workspace?.name || "Workspace")}\n\nUse the menu below:`,
      mainMenuKeyboard()
    );
    return;
  }

  // ── Start conversational content creation ──
  if (data === "conversation:create") {
    await editTelegramMessage(
      ctx.chatId,
      ctx.messageId,
      "✍️ *Create a LinkedIn post*\n\nSend me your topic, rough idea, audience, or point of view. I will create a draft using your saved voice and strategy. Then you can ask for revisions naturally.\n\nNothing is published without a separate approval action.",
      { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "menu:main" }]] }
    );
    return;
  }

  // ── Drafts / Approvals ──
  if (data === "menu:drafts" || data === "menu:approvals" || data.startsWith("draft:prev:") || data.startsWith("draft:next:")) {
    const parsedOffset = data.startsWith("draft:prev:") || data.startsWith("draft:next:")
      ? parseInt(data.split(":")[2] || "0", 10)
      : 0;
    const offset = Number.isSafeInteger(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;
    const statusFilter = data === "menu:approvals" ? ["needs_review"] : ["draft", "needs_review"];

    const list = await buildDraftList(supabase, workspaceId, statusFilter, offset);
    await editTelegramMessage(ctx.chatId, ctx.messageId, list.text, list.markup);
    return;
  }

  // ── View a draft as an image ──
  if (data.startsWith("draft:view:")) {
    const postId = data.slice("draft:view:".length);
    const { data: post, error: postError } = await supabase
      .from("content_posts")
      .select("id, internal_title, text, status")
      .eq("id", postId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (postError || !post || !["draft", "needs_review"].includes(post.status)) {
      await editTelegramMessage(
        ctx.chatId,
        ctx.messageId,
        "This draft is no longer available\\.",
        { inline_keyboard: [[{ text: "📝 My Drafts", callback_data: "menu:drafts" }]] }
      );
      return;
    }

    const browser = await getRequestBrowserBinding();
    await sendTelegramDraftPreview(ctx.chatId, post, false, browser, { fastFail: true });
    return;
  }

  // ── Request changes to the active draft ──
  if (data.startsWith("draft:revise:")) {
    const postId = data.slice("draft:revise:".length);
    const { data: post, error: postError } = await supabase
      .from("content_posts")
      .select("id, status")
      .eq("id", postId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (postError || !post || post.status !== "draft") {
      await editTelegramMessage(
        ctx.chatId,
        ctx.messageId,
        "This draft is no longer available for revision\\.",
        { inline_keyboard: [[{ text: "📝 My Drafts", callback_data: "menu:drafts" }]] }
      );
      return;
    }

    await editTelegramMessage(
      ctx.chatId,
      ctx.messageId,
      "✏️ *What should I change?*\n\nSend your revision request as a normal message\. For example: _make the opening stronger_ or _add a practical example_\. I'll update this draft and send a fresh image preview\. Nothing is published.",
      { inline_keyboard: [[{ text: "📝 My Drafts", callback_data: "menu:drafts" }]] }
    );
    return;
  }

  // ── Approve (confirm step) ──
  if (data.startsWith("draft:approve:") && !data.startsWith("draft:approve_confirm:")) {
    const postId = data.replace("draft:approve:", "");

    if (!canPublishEntitlement(entitlement)) {
      await editTelegramMessage(
        ctx.chatId,
        ctx.messageId,
        `⛔ *Action Restricted*\n\nYour entitlement \`${escapeMd(entitlement)}\` does not permit approvals\\.\nAn active trial or subscription is required\\.`,
        { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "menu:main" }]] }
      );
      return;
    }

    const approveTitle = await loadPostTitle(supabase, workspaceId, postId);
    await editTelegramMessage(
      ctx.chatId,
      ctx.messageId,
      `✅ *Confirm Approval*\n\nApprove _${escapeMd(approveTitle)}_ for publishing?`,
      {
        inline_keyboard: [
          [
            { text: "✅ Yes, Approve", callback_data: `draft:approve_confirm:${postId}` },
            { text: "Cancel", callback_data: "menu:drafts" },
          ],
        ],
      }
    );
    return;
  }

  // ── Approve (confirmed) ──
  if (data.startsWith("draft:approve_confirm:")) {
    const postId = data.replace("draft:approve_confirm:", "");

    if (!canPublishEntitlement(entitlement)) {
      await editTelegramMessage(
        ctx.chatId,
        ctx.messageId,
        `⛔ *Action Restricted*\n\nSubscription or beta access required\\.`,
        { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "menu:main" }]] }
      );
      return;
    }

    // Verify post belongs to this workspace
    const { data: post } = await supabase
      .from("content_posts")
      .select("id, status, internal_title")
      .eq("id", postId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!post) {
      await editTelegramMessage(
        ctx.chatId,
        ctx.messageId,
        `❌ *Post not found or access denied\\.* The post may have been deleted\\.`,
        { inline_keyboard: [[{ text: "📝 Drafts", callback_data: "menu:drafts" }, { text: "🏠 Menu", callback_data: "menu:main" }]] }
      );
      return;
    }

    const { data: approvedRows, error: approveErr } = await supabase
      .from("content_posts")
      .update({ status: "approved" })
      .eq("id", post.id)
      .eq("workspace_id", workspaceId)
      .in("status", ["draft", "needs_review"])
      .select("id");

    if (approveErr || !approvedRows || approvedRows.length === 0) {
      await editTelegramMessage(
        ctx.chatId,
        ctx.messageId,
        `❌ *Could not approve this draft\\.* It may already be approved, published or rejected\\.`,
        { inline_keyboard: [[{ text: "📝 Drafts", callback_data: "menu:drafts" }, { text: "🏠 Menu", callback_data: "menu:main" }]] }
      );
      return;
    }

    const { error: callbackApprovalSignalError } = await supabase.from("approval_events").insert({
      workspace_id: workspaceId, post_id: post.id, actor_type: "telegram", action: "approved",
    });
    if (callbackApprovalSignalError) console.error("[telegram] Approval learning signal failed:", callbackApprovalSignalError.message);

    await supabase.from("audit_events").insert({
      workspace_id: workspaceId,
      actor_type: "telegram",
      action: "post_approved",
      resource_type: "content_post",
      resource_id: post.id,
      safe_metadata: { source: "telegram_callback" },
    });

    const title = escapeMd((post.internal_title || "Post").slice(0, 40));
    // Approval means "publish this": put it on the next preferred slot instead
    // of leaving it parked. The user can still cancel from the buttons below.
    const { data: ownerRow } = await supabase.from("workspaces").select("owner_user_id").eq("id", workspaceId).maybeSingle();
    const scheduled = ownerRow?.owner_user_id
      ? await scheduleApprovedPost(supabase, {
          workspaceId, ownerUserId: ownerRow.owner_user_id, postId: post.id,
          minLeadMs: APPROVAL_LEAD_MS, autopilot: false,
        })
      : { ok: false as const, reason: "WORKSPACE_ACCESS_DENIED" };
    if (scheduled.ok) {
      await supabase.from("audit_events").insert({
        workspace_id: workspaceId, actor_type: "telegram", action: "schedule_post",
        resource_type: "content_post", resource_id: post.id,
        safe_metadata: { source: "telegram_callback", scheduledFor: scheduled.scheduledFor },
      });
      await editTelegramMessage(
        ctx.chatId,
        ctx.messageId,
        `✅ *Approved\\!*\n\n_${title}_ will be published on ${escapeMd(formatScheduledTime(scheduled.scheduledFor, scheduled.timezone))}\\.`,
        {
          inline_keyboard: [
            [{ text: "🛑 Cancel schedule", callback_data: `post:cancel:${post.id}` }],
            [{ text: "📝 More Drafts", callback_data: "menu:drafts" }, { text: "🏠 Menu", callback_data: "menu:main" }],
          ],
        }
      );
      return;
    }
    const whyNot: Record<string, string> = {
      DAILY_CAP_REACHED: "your daily posting limit is reached",
      WEEKLY_CAP_REACHED: "your 7\\-day posting limit is reached",
      WORKSPACE_PAUSED: "Nunuza is paused",
    };
    await editTelegramMessage(
      ctx.chatId,
      ctx.messageId,
      `✅ *Approved\\!*\n\n_${title}_ is approved but was not scheduled${whyNot[scheduled.reason] ? ": " + whyNot[scheduled.reason] : ""}\\. You can schedule it from the dashboard\\.`,
      {
        inline_keyboard: [
          [{ text: "📝 More Drafts", callback_data: "menu:drafts" }, { text: "🏠 Menu", callback_data: "menu:main" }],
        ],
      }
    );
    return;
  }

  // ── Reject (confirm step) ──
  if (data.startsWith("draft:reject:") && !data.startsWith("draft:reject_confirm:")) {
    const postId = data.replace("draft:reject:", "");

    const rejectTitle = await loadPostTitle(supabase, workspaceId, postId);
    await editTelegramMessage(
      ctx.chatId,
      ctx.messageId,
      `❌ *Confirm Rejection*\n\nReject _${escapeMd(rejectTitle)}_? This cannot be undone\\.`,
      {
        inline_keyboard: [
          [
            { text: "❌ Yes, Reject", callback_data: `draft:reject_confirm:${postId}` },
            { text: "Cancel", callback_data: "menu:drafts" },
          ],
        ],
      }
    );
    return;
  }

  // ── Reject (confirmed) ──
  if (data.startsWith("draft:reject_confirm:")) {
    const postId = data.replace("draft:reject_confirm:", "");

    const { data: post } = await supabase
      .from("content_posts")
      .select("id, internal_title")
      .eq("id", postId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!post) {
      await editTelegramMessage(
        ctx.chatId,
        ctx.messageId,
        `❌ *Post not found or access denied\\.`,
        { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "menu:main" }]] }
      );
      return;
    }

    const { data: rejectedRows, error: rejectError } = await supabase
      .from("content_posts")
      .update({ status: "rejected" })
      .eq("id", post.id)
      .eq("workspace_id", workspaceId)
      .in("status", ["draft", "needs_review"])
      .select("id");

    if (rejectError || !rejectedRows?.length) {
      await editTelegramMessage(
        ctx.chatId,
        ctx.messageId,
        "❌ *Could not reject this draft\\.* It may already have changed status\\.",
        { inline_keyboard: [[{ text: "📝 Drafts", callback_data: "menu:drafts" }]] }
      );
      return;
    }

    const { error: callbackRejectionSignalError } = await supabase.from("approval_events").insert({
      workspace_id: workspaceId, post_id: post.id, actor_type: "telegram",
      action: "rejected", reason: "Rejected via Telegram",
    });
    if (callbackRejectionSignalError) console.error("[telegram] Rejection learning signal failed:", callbackRejectionSignalError.message);

    await supabase.from("audit_events").insert({
      workspace_id: workspaceId,
      actor_type: "telegram",
      action: "post_rejected",
      resource_type: "content_post",
      resource_id: post.id,
      safe_metadata: { reason: "Rejected via Telegram" },
    });

    const title = escapeMd((post.internal_title || "Post").slice(0, 40));
    await editTelegramMessage(
      ctx.chatId,
      ctx.messageId,
      `🗑️ *Rejected*\n\n_${title}_ has been rejected\\.`,
      {
        inline_keyboard: [
          [{ text: "📝 More Drafts", callback_data: "menu:drafts" }, { text: "🏠 Menu", callback_data: "menu:main" }],
        ],
      }
    );
    return;
  }

  // ── Schedule / Publishing ──
  if (data === "menu:schedule") {
    const { data: scheduled, error: scheduleError } = await supabase
      .from("content_posts")
      .select("id, internal_title, scheduled_at, status")
      .eq("workspace_id", workspaceId)
      .in("status", ["scheduled", "approved"])
      .order("scheduled_at", { ascending: true })
      .limit(5);

    if (scheduleError) {
      await editTelegramMessage(ctx.chatId, ctx.messageId, "❌ *Could not load the schedule\\.* Please retry\\.", { inline_keyboard: [navRow()] });
      return;
    }
    if (!scheduled || scheduled.length === 0) {
      await editTelegramMessage(
        ctx.chatId,
        ctx.messageId,
        "📅 *No scheduled posts\\.*\n\nApprove a draft first, then schedule it from the web dashboard\\.",
        {
          inline_keyboard: [
            [{ text: "✅ Approvals", callback_data: "menu:approvals" }],
            [{ text: "🏠 Main Menu", callback_data: "menu:main" }],
          ],
        }
      );
      return;
    }

    let msgText = `📅 *Scheduled & Approved Posts*\n\n`;
    const buttons: any[] = [];

    scheduled.forEach((p: any, idx: number) => {
      const title = escapeMd((p.internal_title || "Post").slice(0, 40));
      const when = p.scheduled_at
        ? escapeMd(new Date(p.scheduled_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }))
        : "Not scheduled";
      const statusEmoji = p.status === "scheduled" ? "📅" : "✅";
      msgText += `${idx + 1}\\. ${statusEmoji} *${title}*\n   ${when}\n\n`;
      if (p.status === "approved" && canPublishEntitlement(entitlement)) {
        buttons.push([{ text: `🚀 Publish Now #${idx + 1}`, callback_data: `post:publish_now:${p.id}` }]);
      }
      if (p.status === "scheduled") {
        buttons.push([{ text: `🗑️ Cancel #${idx + 1}`, callback_data: `post:cancel:${p.id}` }]);
      }
    });

    buttons.push([{ text: "🏠 Main Menu", callback_data: "menu:main" }]);

    await editTelegramMessage(ctx.chatId, ctx.messageId, msgText.trim(), { inline_keyboard: buttons });
    return;
  }

  // ── Publish Now ──
  if (data.startsWith("post:publish_now:")) {
    const postId = data.replace("post:publish_now:", "");

    if (!canPublishEntitlement(entitlement)) {
      await editTelegramMessage(
        ctx.chatId,
        ctx.messageId,
        `⛔ *Publishing Restricted*\n\nSubscription or beta access required\\.`,
        { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "menu:main" }]] }
      );
      return;
    }

    // Verify post belongs to this workspace
    const { data: post } = await supabase
      .from("content_posts")
      .select("id, status, internal_title")
      .eq("id", postId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!post || post.status !== "approved") {
      await editTelegramMessage(
        ctx.chatId,
        ctx.messageId,
        `❌ *Cannot publish\\.* Post not found, not approved, or already published\\.`,
        { inline_keyboard: [[{ text: "📅 Schedule", callback_data: "menu:schedule" }, { text: "🏠 Menu", callback_data: "menu:main" }]] }
      );
      return;
    }

    // Show processing state
    await editTelegramMessage(
      ctx.chatId,
      ctx.messageId,
      `⏳ *Publishing\\.\\.\\.*\n\nSending to LinkedIn, please wait\\.`,
      { inline_keyboard: [] }
    );

    // Call existing publishPostNow pipeline
    try {
      const { publishPostNow } = await import("@/lib/jobs/scheduling");
      const result = await publishPostNow(workspaceId, postId);
      if (result.execution?.success) {
        const title = escapeMd((post.internal_title || "Post").slice(0, 40));
        await editTelegramMessage(
          ctx.chatId,
          ctx.messageId,
          `🚀 *Published to LinkedIn\\!*\n\n_${title}_ is now live\\.`,
          { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "menu:main" }]] }
        );
      } else {
        const errMsg = escapeMd(result.execution?.error || "Publishing failed.");
        await editTelegramMessage(
          ctx.chatId,
          ctx.messageId,
          `❌ *Publishing Failed*\n\n${errMsg}`,
          { inline_keyboard: [[{ text: "📅 Schedule", callback_data: "menu:schedule" }, { text: "🏠 Menu", callback_data: "menu:main" }]] }
        );
      }
    } catch (err: any) {
      const errMsg = escapeMd(err.message || "Publishing failed.");
      await editTelegramMessage(
        ctx.chatId,
        ctx.messageId,
        `❌ *Publishing Failed*\n\n${errMsg}`,
        { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "menu:main" }]] }
      );
    }
    return;
  }

  // ── Stop an Autopilot post before it publishes ──
  if (data.startsWith("draft:stop:")) {
    const postId = data.slice("draft:stop:".length);
    const { data: post } = await supabase
      .from("content_posts").select("id, status, internal_title")
      .eq("id", postId).eq("workspace_id", workspaceId).maybeSingle();
    const back = { inline_keyboard: [[{ text: "📝 Drafts", callback_data: "menu:drafts" }, { text: "🏠 Menu", callback_data: "menu:main" }]] };
    if (!post) {
      await editTelegramMessage(ctx.chatId, ctx.messageId, "❌ *Post not found\\.*", back);
      return;
    }
    if (post.status === "published" || post.status === "publishing") {
      await editTelegramMessage(ctx.chatId, ctx.messageId, "⚠️ *Too late to stop\\.* This post is already live or being published\\.", back);
      return;
    }
    const stopped = post.status === "scheduled"
      ? await cancelScheduledPostByAgent(supabase, workspaceId, postId)
      : { ok: post.status === "approved" || post.status === "needs_review" };
    if (!stopped.ok) {
      await editTelegramMessage(ctx.chatId, ctx.messageId, "⚠️ *Too late to stop\\.* This post is already being published\\.", back);
      return;
    }
    // Back to review so it can be edited, approved or rejected later.
    await supabase.from("content_posts").update({ status: "needs_review", scheduled_at: null })
      .eq("id", postId).eq("workspace_id", workspaceId).eq("status", "approved");
    await supabase.from("audit_events").insert({
      workspace_id: workspaceId, actor_type: "telegram", action: "autopilot_post_stopped",
      resource_type: "content_post", resource_id: postId, safe_metadata: { source: "telegram_callback" },
    });
    const title = escapeMd((post.internal_title || "Post").slice(0, 40));
    await editTelegramMessage(ctx.chatId, ctx.messageId,
      `🛑 *Stopped\\.* _${title}_ will not be published\\. It is back in your drafts\\.`,
      { inline_keyboard: [[{ text: "👁 View draft", callback_data: `draft:view:${postId}` }], [{ text: "🏠 Menu", callback_data: "menu:main" }]] });
    return;
  }

  // ── Cancel Scheduled Post ──
  if (data.startsWith("post:cancel:")) {
    const postId = data.replace("post:cancel:", "");

    const { data: post } = await supabase
      .from("content_posts")
      .select("id, status, internal_title")
      .eq("id", postId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!post || post.status !== "scheduled") {
      await editTelegramMessage(
        ctx.chatId,
        ctx.messageId,
        `❌ *Cannot cancel\\.* Post not found or not scheduled\\.`,
        { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "menu:main" }]] }
      );
      return;
    }

    const canceled = await cancelScheduledPostByAgent(supabase, workspaceId, postId);
    if (!canceled.ok) {
      await editTelegramMessage(ctx.chatId, ctx.messageId, canceled.reason === "JOB_NOT_CANCELLABLE"
        ? "⚠️ *Too late to cancel\\.* This post is already being published\\."
        : "❌ *Could not cancel this schedule\\.* Refresh the schedule and try again\\.", { inline_keyboard: [[{ text: "📅 Schedule", callback_data: "menu:schedule" }]] });
      return;
    }

    const title = escapeMd((post.internal_title || "Post").slice(0, 40));
    await editTelegramMessage(
      ctx.chatId,
      ctx.messageId,
      `✅ *Schedule Cancelled*\n\n_${title}_ is back to approved status\\.`,
      { inline_keyboard: [[{ text: "📅 Schedule", callback_data: "menu:schedule" }, { text: "🏠 Menu", callback_data: "menu:main" }]] }
    );
    return;
  }

  // ── Performance ──
  if (data === "menu:performance") {
    try {
      const quotaPeriod = await getDraftUsagePeriod(workspaceId, workspace.owner_user_id);
      const { data: usageData, error: usageError } = await supabase.rpc("get_draft_usage_status", {
        p_workspace_id: workspaceId,
        p_owner_user_id: workspace.owner_user_id,
        p_period_start: quotaPeriod.periodStart,
        p_metric: quotaPeriod.metric,
      });

      if (usageError) throw usageError;
      const usage = Array.isArray(usageData) ? usageData[0] : usageData;
      const used = Number(usage?.used_count ?? 0) + Number(usage?.reserved_count ?? 0);

      await editTelegramMessage(
        ctx.chatId,
        ctx.messageId,
        `📈 *Draft Usage*\\n\\n` +
        `• *Generated items:* ${used} / 30\\n` +
        `• *Daily cap:* Max 1 post/day\\n` +
        `• *Weekly cap:* Max 7 posts/week\\n` +
        `• *Resets on:* ${escapeMd(quotaPeriod.resetsOn)}\\n\\n` +
        `_Usage counters only; LinkedIn audience analytics are not connected._`,
        { inline_keyboard: [navRow()] }
      );
    } catch {
      await editTelegramMessage(ctx.chatId, ctx.messageId, "❌ *Draft usage is temporarily unavailable\\.* Please retry\\.", { inline_keyboard: [navRow()] });
    }
    return;
  }

  // ── Agent Status & Controls ──
  if (data === "menu:agent") {
    const isPaused = !!workspace?.paused_at;
    const modeLabel = workspace?.operating_mode === "autopilot" ? "Autopilot" : "Approval Required";

    const { count: pendingCount } = await supabase
      .from("content_posts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .in("status", ["draft", "needs_review"]);

    await editTelegramMessage(
      ctx.chatId,
      ctx.messageId,
      `🤖 *Agent Status*\n\n` +
      `• *State:* ${isPaused ? "⏸️ Paused" : "▶️ Active"}\n` +
      `• *Mode:* ${escapeMd(modeLabel)}\n` +
      `• *Entitlement:* \`${escapeMd(entitlement)}\`\n` +
      `• *Pending Drafts:* ${pendingCount ?? 0}`,
      {
        inline_keyboard: [
          [
            isPaused
              ? { text: "▶️ Resume Agent", callback_data: "agent:resume" }
              : { text: "⏸️ Pause Agent", callback_data: "agent:pause" },
          ],
          [{ text: "🏠 Main Menu", callback_data: "menu:main" }],
        ],
      }
    );
    return;
  }

  // ── Agent Pause (confirm) ──
  if (data === "agent:pause") {
    await editTelegramMessage(
      ctx.chatId,
      ctx.messageId,
      `⏸️ *Pause Agent?*\n\nThis will stop autonomous drafting and operations\\. Existing scheduled posts are preserved\\.`,
      {
        inline_keyboard: [
          [
            { text: "⏸️ Yes, Pause", callback_data: "agent:pause_confirm" },
            { text: "Cancel", callback_data: "menu:agent" },
          ],
        ],
      }
    );
    return;
  }

  // ── Agent Pause (confirmed) ──
  if (data === "agent:pause_confirm") {
    const { error: pauseError } = await supabase
      .from("workspaces")
      .update({ paused_at: new Date().toISOString(), state: "paused" })
      .eq("id", workspaceId);
    if (pauseError) {
      await editTelegramMessage(ctx.chatId, ctx.messageId, "❌ *Could not pause the agent\\.* Please retry\\.", { inline_keyboard: [navRow("menu:agent")] });
      return;
    }

    await supabase.from("audit_events").insert({
      workspace_id: workspaceId,
      actor_type: "telegram",
      action: "agent_paused",
      resource_type: "workspace",
      resource_id: workspaceId,
      safe_metadata: { source: "telegram_callback" },
    });

    await editTelegramMessage(
      ctx.chatId,
      ctx.messageId,
      `⏸️ *Agent Paused*\n\nAutonomous operations are now paused\\.`,
      {
        inline_keyboard: [
          [{ text: "▶️ Resume", callback_data: "agent:resume" }],
          [{ text: "🏠 Main Menu", callback_data: "menu:main" }],
        ],
      }
    );
    return;
  }

  // ── Agent Resume ──
  if (data === "agent:resume") {
    const { error: resumeError } = await supabase
      .from("workspaces")
      .update({
        paused_at: null,
        state: workspace?.operating_mode === "autopilot" ? "active_autopilot" : "active_approval_required",
      })
      .eq("id", workspaceId);
    if (resumeError) {
      await editTelegramMessage(ctx.chatId, ctx.messageId, "❌ *Could not resume the agent\\.* Please retry\\.", { inline_keyboard: [navRow("menu:agent")] });
      return;
    }

    await supabase.from("audit_events").insert({
      workspace_id: workspaceId,
      actor_type: "telegram",
      action: "agent_resumed",
      resource_type: "workspace",
      resource_id: workspaceId,
      safe_metadata: { source: "telegram_callback" },
    });

    await editTelegramMessage(
      ctx.chatId,
      ctx.messageId,
      `▶️ *Agent Resumed*\n\nAutonomous operations are now active\\.`,
      {
        inline_keyboard: [
          [{ text: "🤖 Agent Status", callback_data: "menu:agent" }],
          [{ text: "🏠 Main Menu", callback_data: "menu:main" }],
        ],
      }
    );
    return;
  }

  // ── Settings ──
  if (data === "menu:settings") {
    await editTelegramMessage(
      ctx.chatId,
      ctx.messageId,
      `⚙️ *Settings \\— ${escapeMd(workspace?.name || "Workspace")}*\n\n` +
      `• Entitlement: \`${escapeMd(entitlement)}\`\n` +
      `• Mode: \`${escapeMd(workspace?.operating_mode || "approval_required")}\`\n\n` +
      `Manage your account from the dashboard:`,
      {
        inline_keyboard: [
          [{ text: "🌐 Open Settings", url: `${appUrl}/app/settings` }],
          [{ text: "🏠 Main Menu", callback_data: "menu:main" }],
        ],
      }
    );
    return;
  }

  // ── Help ──
  if (data === "menu:help") {
    await editTelegramMessage(
      ctx.chatId,
      ctx.messageId,
      `❓ *Help*\n\n` +
      `Send me a message describing the LinkedIn post you want and I will write a draft in your voice\\. ` +
      `Every draft arrives as an image with buttons to approve, reject or ask for changes\\.\n\n` +
      `Use the Menu button next to the message box for shortcuts, or the buttons below\\.`,
      { inline_keyboard: [navRow()] }
    );
    return;
  }

  // ── Noop / unknown ──
  // Just do nothing (spinner already dismissed)
}

// ─── Dispatch Outgoing Message ────────────────────────────────────────────────

export async function sendTelegramMessage(
  chatId: number,
  text: string,
  replyMarkup?: any
): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.trim() === "") {
    console.error("[telegram] sendTelegramMessage: TELEGRAM_BOT_TOKEN is not configured.");
    return { ok: false, error: "Telegram bot is not configured." };
  }

  try {
    const payload: any = {
      chat_id: chatId,
      text,
      parse_mode: "MarkdownV2",
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    const data = (await response.json()) as any;
    if (!response.ok || !data.ok) {
      // Fallback to plain text on parse error
      if (data.description && typeof data.description === "string" && data.description.includes("can't parse entities")) {
        delete payload.parse_mode;
        payload.text = text.replace(/\\/g, "");
        const retryRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });
        const retryData = (await retryRes.json()) as any;
        if (!retryData.ok) {
          console.error("[telegram] sendMessage plain text retry error:", retryData);
          return { ok: false, error: retryData.description };
        }
        return { ok: true };
      }
      console.error("[telegram] sendMessage error:", data);
      return { ok: false, error: data.description };
    }
    return { ok: true };
  } catch (err: any) {
    console.error("[telegram] sendMessage request failed:", err?.name || "UnknownError");
    return { ok: false, error: "Telegram API request failed." };
  }
}

export interface DraftPreviewOptions {
  /**
   * Set when the agent has already scheduled this post (Autopilot). The
   * buttons become Stop / Request Changes and the caption states the time.
   */
  scheduledLabel?: string;
  /**
   * Use short deadlines so the whole delivery, including the fallback notice,
   * finishes inside the 30 seconds a Worker keeps running after its response
   * (`waitUntil`). The queue consumer keeps the longer defaults.
   */
  fastFail?: boolean;
}

/**
 * Sends a draft to Telegram as an IMAGE with the review buttons.
 *
 * The draft text itself is never sent as a Telegram message. If the image
 * cannot be rendered, the user gets a short notice with the same buttons and a
 * link to the draft in Nunuza instead of the raw text.
 */
export async function sendTelegramDraftPreview(
  chatId: number,
  post: { id: string; internal_title?: string | null; text?: string | null },
  revised = false,
  browserBinding?: TelegramBrowserBinding,
  options: DraftPreviewOptions = {}
): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const signingSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!token?.trim()) {
    return { ok: false, error: "Telegram bot is not configured." };
  }

  const scheduledLabel = options.scheduledLabel;
  const replyMarkup = scheduledLabel
    ? {
        inline_keyboard: [
          [{ text: "🛑 Stop — don't publish", callback_data: `draft:stop:${post.id}` }],
          [{ text: "✏️ Request Changes", callback_data: `draft:revise:${post.id}` }],
        ],
      }
    : {
        inline_keyboard: [
          [
            { text: "✅ Approve & Publish", callback_data: `draft:approve:${post.id}` },
            { text: "❌ Reject", callback_data: `draft:reject:${post.id}` },
          ],
          [{ text: "✏️ Request Changes", callback_data: `draft:revise:${post.id}` }],
        ],
      };

  // A saved draft must not be held hostage by image rendering. If Browser
  // Rendering is unavailable or slow, tell the user the draft is ready and keep
  // the review buttons, but never paste the draft text into the chat.
  const sendUnavailableNotice = async (reason: string): Promise<{ ok: boolean; error?: string }> => {
    console.warn("[telegram] Draft image preview unavailable; sending notice without draft text:", reason);
    const title = (post.internal_title || "Your LinkedIn draft").slice(0, 120);
    const keyboard = appUrl?.trim().startsWith("https://")
      ? {
          inline_keyboard: [
            ...replyMarkup.inline_keyboard,
            [{ text: "🖼 Show image preview", callback_data: `draft:view:${post.id}` }],
            [{ text: "📝 Open in Nunuza", url: new URL(`/app/content?post=${encodeURIComponent(post.id)}`, appUrl).toString() }],
          ],
        }
      : replyMarkup;
    const message = scheduledLabel
      ? "🕐 Nunuza will publish this LinkedIn post on " + scheduledLabel + ".\n\n" + title +
        "\n\nThe image preview is not available right now. Tap Stop if you do not want it published."
      : (revised ? "✏️ Your LinkedIn draft has been revised." : "📝 Your LinkedIn draft is ready.") +
        "\n\n" + title +
        "\n\nThe image preview is not available right now. Your draft is saved in Nunuza and nothing has been published.";
    const delivery = await sendTelegramMessage(chatId, escapeMd(message), keyboard);
    return delivery.ok ? { ok: true } : { ok: false, error: delivery.error || "Could not notify you about the saved draft in Telegram." };
  };

  if (!signingSecret?.trim() || !appUrl?.trim()) {
    return sendUnavailableNotice("preview configuration is incomplete");
  }
  if (!browserBinding) {
    return sendUnavailableNotice("Browser Rendering binding is unavailable");
  }

  const fast = options.fastFail === true;
  // "fast" is for request-scoped work (dashboard, MCP, webhook) that a Worker
  // cuts off ~30s after the response. A cold browser needs more than the old
  // 15s, which is why web drafts fell back to the "preview not available" notice.
  const gotoTimeoutMs = fast ? 18_000 : 45_000;
  const renderDeadlineMs = fast ? 23_000 : 60_000;
  const readDeadlineMs = fast ? 2_000 : 15_000;
  const uploadDeadlineMs = fast ? 4_000 : 20_000;

  const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(label)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  try {
    const expires = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    const signature = crypto.createHmac("sha256", signingSecret).update(`${post.id}.${expires}`).digest("hex");
    const previewUrl = new URL(`/api/telegram/draft-preview/${encodeURIComponent(post.id)}`, appUrl);
    previewUrl.searchParams.set("expires", String(expires));
    previewUrl.searchParams.set("signature", signature);

    // The browser navigation timeout does not bound the full Browser Binding
    // request. Add an outer deadline so a stalled binding cannot hold a Queue
    // message and its database lease indefinitely.
    const imageResponse = await withTimeout(
      browserBinding.quickAction("screenshot", {
        url: previewUrl.toString(),
        // Square canvas: Telegram shows a square photo fully in the chat.
        viewport: { width: 1080, height: 1080 },
        screenshotOptions: { fullPage: true },
        gotoOptions: { waitUntil: "networkidle0", timeout: gotoTimeoutMs },
      }),
      renderDeadlineMs,
      "Browser Rendering request timed out"
    );
    if (!imageResponse.ok) {
      return sendUnavailableNotice(`Browser Rendering returned HTTP ${imageResponse.status}`);
    }

    const imageType = imageResponse.headers.get("content-type") || "";
    if (!imageType.includes("image/")) {
      return sendUnavailableNotice("Browser Rendering did not return an image");
    }
    const image = await withTimeout(
      imageResponse.arrayBuffer(),
      readDeadlineMs,
      "Reading the rendered image timed out"
    );
    if (image.byteLength === 0 || image.byteLength > 10 * 1024 * 1024) {
      return sendUnavailableNotice("The rendered image size was invalid");
    }

    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("photo", new Blob([image], { type: imageType }), "nunuza-draft.png");
    form.append(
      "caption",
      scheduledLabel
        ? `🕐 Scheduled to publish on ${scheduledLabel}.\nTap Stop if you do not want it published.`
        : revised
          ? "✏️ Your LinkedIn draft has been revised.\nSaved as a draft. Nothing has been published."
          : "📝 Your LinkedIn draft is ready.\nSaved as a draft. Nothing has been published."
    );
    form.append("reply_markup", JSON.stringify(replyMarkup));

    const response = await fetch(TG_API(token, "sendPhoto"), {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(uploadDeadlineMs),
    });
    const result: any = await response.json();
    if (!response.ok || !result?.ok) {
      return sendUnavailableNotice(result?.description || `Telegram photo upload failed (HTTP ${response.status})`);
    }
    return { ok: true };
  } catch (error) {
    return sendUnavailableNotice(error instanceof Error ? error.message : "Unknown preview delivery error");
  }
}

/**
 * Sends a draft to the workspace's linked Telegram chat as an image with the
 * review buttons. Used by every path that creates a draft outside the Telegram
 * chat itself (dashboard, MCP, autonomous cycle). Resolves the Browser
 * Rendering binding from the Worker request when the caller does not have one.
 */
export async function notifyWorkspaceTelegramDraft(
  workspaceId: string,
  post: { id: string; internal_title?: string | null; text?: string | null },
  options: { revised?: boolean; supabase?: any; browser?: TelegramBrowserBinding; fastFail?: boolean; scheduledLabel?: string } = {}
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = options.supabase || createServiceClient();
    const { data: link, error } = await supabase
      .from("telegram_links")
      .select("chat_id")
      .eq("workspace_id", workspaceId)
      .is("revoked_at", null)
      .maybeSingle();
    if (error || !link?.chat_id) {
      return { ok: false, error: "No active Telegram link for workspace" };
    }
    const browser = options.browser ?? (await getRequestBrowserBinding());
    return await sendTelegramDraftPreview(link.chat_id, post, options.revised ?? false, browser, {
      fastFail: options.fastFail,
      scheduledLabel: options.scheduledLabel,
    });
  } catch (err: any) {
    console.warn(`[telegram] notifyWorkspaceTelegramDraft error for workspace ${workspaceId}:`, err?.message);
    return { ok: false, error: err?.message || "Draft notification failed" };
  }
}

export async function notifyWorkspaceTelegram(
  workspaceId: string,
  message: { text: string; replyMarkup?: any },
  supabaseOverride?: any
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = supabaseOverride || createServiceClient();
    if (!supabase || typeof supabase.from !== "function") return { ok: false, error: "Database client unavailable" };

    const table = supabase.from("telegram_links");
    if (!table || typeof table.select !== "function") {
      return { ok: false, error: "telegram_links table not available in current client" };
    }

    const { data: link, error } = await table
      .select("chat_id")
      .eq("workspace_id", workspaceId)
      .is("revoked_at", null)
      .maybeSingle();

    if (error || !link || !link.chat_id) {
      return { ok: false, error: "No active Telegram link for workspace" };
    }

    return await sendTelegramMessage(link.chat_id, message.text, message.replyMarkup);
  } catch (err: any) {
    console.warn(`[telegram] notifyWorkspaceTelegram error for workspace ${workspaceId}:`, err.message);
    return { ok: false, error: err.message };
  }
}

// ─── Bot Commands Registration ────────────────────────────────────────────────

export async function registerBotCommands(): Promise<{ ok: boolean; description?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, description: "TELEGRAM_BOT_TOKEN not configured" };

  const commands = [
    { command: "start", description: "Open main menu" },
    { command: "status", description: "Agent & workspace status" },
    { command: "drafts", description: "Review pending drafts" },
    { command: "pause", description: "Pause the agent" },
    { command: "resume", description: "Resume the agent" },
    { command: "report", description: "Monthly performance report" },
    { command: "settings", description: "Account settings" },
    { command: "new", description: "Start a new content draft" },
    { command: "cancel", description: "End the current chat session" },
    { command: "help", description: "Show help & commands" },
  ];

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands }),
      signal: AbortSignal.timeout(10_000),
    });
    const result: any = await res.json();
    if (!res.ok || !result?.ok) {
      return { ok: false, description: result?.description || `Telegram API returned HTTP ${res.status}.` };
    }
    return { ok: true };
  } catch (err: any) {
    console.error("[telegram] setMyCommands request failed:", err?.name || "UnknownError");
    return { ok: false, description: "Telegram API request failed." };
  }
}

// ─── Webhook Management ───────────────────────────────────────────────────────

export async function registerTelegramWebhook(
  webhookUrl: string,
  secretToken?: string
): Promise<{ ok: boolean; description?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

  const secret = secretToken || process.env.TELEGRAM_WEBHOOK_SECRET;
  const url = new URL(`https://api.telegram.org/bot${token}/setWebhook`);
  url.searchParams.set("url", webhookUrl);
  if (secret) {
    url.searchParams.set("secret_token", secret);
  }

  const res = await fetch(url.toString());
  return await res.json();
}

export async function deleteTelegramWebhook(): Promise<{ ok: boolean; description?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

  const res = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
  return await res.json();
}

export async function getTelegramWebhookInfo(): Promise<any> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

  const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  return await res.json();
}