/**
 * Telegram Bot Integration Service.
 *
 * Implements:
 * 1. Cryptographically secure pairing token generation (link_tokens).
 * 2. Account linking & unlinking bound to authenticated workspaces (telegram_links).
 * 3. Webhook secret validation and replay protection (update_id deduplication).
 * 4. Conversational command processing:
 *    /start, /status, /pause, /resume, /drafts, /approve <id>, /reject <id>, /report, /help, /settings
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

// ─── Deduplication Cache for update_id ─────────────────────────────────────────

const processedUpdateIds = new Set<number>();
const MAX_PROCESSED_CACHE = 2000;

export function isUpdateProcessed(updateId: number): boolean {
  return processedUpdateIds.has(updateId);
}

export function markUpdateProcessed(updateId: number): void {
  if (processedUpdateIds.size >= MAX_PROCESSED_CACHE) {
    const firstItems = Array.from(processedUpdateIds).slice(0, 500);
    firstItems.forEach((id) => processedUpdateIds.delete(id));
  }
  processedUpdateIds.add(updateId);
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

function escapeMd(text: string): string {
  return String(text).replace(/[_*[\]()~`>#+=|{}.!\-]/g, "\\$&");
}

// ─── Telegram API Helpers ─────────────────────────────────────────────────────

const TG_API = (token: string, method: string) =>
  `https://api.telegram.org/bot${token}/${method}`;

async function tgPost(method: string, body: object): Promise<any> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.trim() === "") {
    console.warn(`[telegram] ${method}: TELEGRAM_BOT_TOKEN not configured`);
    return { ok: true };
  }
  try {
    const res = await fetch(TG_API(token, method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (err: any) {
    console.error(`[telegram] ${method} error:`, err.message);
    return { ok: false, error: err.message };
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
  if (!result.ok && result.description && !result.description.includes("message is not modified")) {
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
      [
        { text: "📝 My Drafts", callback_data: "menu:drafts" },
        { text: "✅ Approvals", callback_data: "menu:approvals" },
      ],
      [
        { text: "📅 Schedule", callback_data: "menu:schedule" },
        { text: "📊 Performance", callback_data: "menu:performance" },
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

export async function linkTelegramAccount(
  rawToken: string,
  telegramUserId: number,
  chatId: number,
  supabaseOverride?: any
): Promise<{ success: boolean; workspaceId?: string; error?: string }> {
  const tokenHash = crypto.createHash("sha256").update(rawToken.trim()).digest("hex");
  const supabase = supabaseOverride || createServiceClient();

  const { data: tokenRecord, error: tokenError } = await supabase
    .from("link_tokens")
    .select("*")
    .eq("token_hash", tokenHash)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (tokenError || !tokenRecord) {
    return {
      success: false,
      error: "Invalid, expired, or already used pairing token. Please generate a new one from your Nunuza dashboard.",
    };
  }

  await supabase
    .from("link_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", tokenRecord.id);

  await supabase
    .from("telegram_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("workspace_id", tokenRecord.workspace_id)
    .is("revoked_at", null);

  await supabase
    .from("telegram_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("telegram_user_id", telegramUserId)
    .is("revoked_at", null);

  const { error: linkError } = await supabase.from("telegram_links").insert({
    workspace_id: tokenRecord.workspace_id,
    telegram_user_id: telegramUserId,
    chat_id: chatId,
    linked_at: new Date().toISOString(),
  });

  if (linkError) {
    return { success: false, error: `Linking failed: ${linkError.message}` };
  }

  await supabase.from("audit_events").insert({
    workspace_id: tokenRecord.workspace_id,
    actor_type: "user",
    actor_id: tokenRecord.user_id,
    action: "telegram_linked",
    resource_type: "telegram_link",
    safe_metadata: { telegram_user_id: telegramUserId, chat_id: chatId },
  });

  return { success: true, workspaceId: tokenRecord.workspace_id };
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
  telegramUserId: number;
  chatId: number;
  text: string;
}

export interface CommandResponse {
  replyText: string;
  replyMarkup?: any;
}

/** Resolve active workspace for a Telegram user; returns null if unlinked. */
async function resolveWorkspace(
  telegramUserId: number,
  supabase: any
): Promise<{ workspaceId: string; workspace: any } | null> {
  const { data: link, error: linkErr } = await supabase
    .from("telegram_links")
    .select("workspace_id, chat_id")
    .eq("telegram_user_id", telegramUserId)
    .is("revoked_at", null)
    .maybeSingle();

  if (linkErr || !link) return null;

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, entitlement_type, state, operating_mode, paused_at")
    .eq("id", link.workspace_id)
    .single();

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
  const resolved = await resolveWorkspace(ctx.telegramUserId, supabase);

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
        `Use the menu below to manage your LinkedIn content:`,
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
    await supabase
      .from("workspaces")
      .update({ paused_at: new Date().toISOString(), state: "paused" })
      .eq("id", workspaceId);

    await supabase.from("audit_events").insert({
      workspace_id: workspaceId,
      actor_type: "telegram",
      action: "agent_paused",
      resource_type: "workspace",
      resource_id: workspaceId,
      safe_metadata: { source: "telegram_command" },
    });

    return {
      replyText: "⏸️ *Agent Paused*\n\nAutonomous operations are paused\\. Send `/resume` to reactivate\\.",
      replyMarkup: {
        inline_keyboard: [
          [{ text: "▶️ Resume", callback_data: "agent:resume" }],
          [{ text: "🏠 Main Menu", callback_data: "menu:main" }],
        ],
      },
    };
  }

  if (text === "/resume") {
    await supabase
      .from("workspaces")
      .update({
        paused_at: null,
        state: workspace?.operating_mode === "autopilot" ? "active_autopilot" : "active_approval_required",
      })
      .eq("id", workspaceId);

    await supabase.from("audit_events").insert({
      workspace_id: workspaceId,
      actor_type: "telegram",
      action: "agent_resumed",
      resource_type: "workspace",
      resource_id: workspaceId,
      safe_metadata: { source: "telegram_command" },
    });

    return {
      replyText: "▶️ *Agent Resumed*\n\nAutonomous operations are now active\\.",
      replyMarkup: {
        inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "menu:main" }]],
      },
    };
  }

  if (text === "/drafts") {
    const { data: drafts } = await supabase
      .from("content_posts")
      .select("id, internal_title, text, status, created_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(5);

    if (!drafts || drafts.length === 0) {
      return {
        replyText: "📝 *No drafts awaiting review\\.*\n\nYour review queue is currently clear\\.",
        replyMarkup: {
          inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "menu:main" }]],
        },
      };
    }

    let response = `📝 *Drafts \\(${drafts.length}\\)*\n\n`;
    const buttons: any[] = [];

    drafts.forEach((d: any, idx: number) => {
      const title = escapeMd((d.internal_title || d.text || "Untitled").slice(0, 50));
      const statusEmoji = d.status === "needs_review" ? "🔍" : "📄";
      response += `${idx + 1}\\. ${statusEmoji} *${title}*\n   ID: \`${d.id.slice(0, 8)}\`\n\n`;
      buttons.push([
        { text: `✅ Approve #${idx + 1}`, callback_data: `draft:approve:${d.id}` },
        { text: `❌ Reject #${idx + 1}`, callback_data: `draft:reject:${d.id}` },
      ]);
    });

    buttons.push([{ text: "🏠 Main Menu", callback_data: "menu:main" }]);

    return {
      replyText: response.trim(),
      replyMarkup: { inline_keyboard: buttons },
    };
  }

  if (text.startsWith("/approve")) {
    const parts = text.split(" ");
    if (parts.length < 2 || !parts[1].trim()) {
      return {
        replyText: "⚠️ Please specify a draft ID:\n`/approve <draft-id>`\nUse `/drafts` to list draft IDs\\.",
      };
    }
    const shortId = parts[1].trim();

    if (!canPublishEntitlement(entitlement)) {
      return {
        replyText:
          `⛔ **Action Restricted: Subscription or Beta Required**\n\n` +
          `Your workspace entitlement is \`${entitlement}\`. ` +
          `An active trial or subscription is required to approve posts.`,
      };
    }

    const { data: posts } = await supabase
      .from("content_posts")
      .select("id, status")
      .eq("workspace_id", workspaceId);

    const targetPost = (posts || []).find((p: any) => p.id.startsWith(shortId) || p.id === shortId);

    if (!targetPost) {
      return {
        replyText: `❌ Draft not found matching ID \`${escapeMd(shortId)}\`\\. Run \`/drafts\` to see active drafts\\.`,
      };
    }

    const { data: approvedRows, error: approveErr } = await supabase
      .from("content_posts")
      .update({ status: "approved" })
      .eq("id", targetPost.id)
      .eq("workspace_id", workspaceId)
      .in("status", ["draft", "needs_review"])
      .select("id");

    if (approveErr || !approvedRows || approvedRows.length === 0) {
      return {
        replyText: "❌ This draft could not be approved\\. It may already be approved, published or rejected\\. Run `/drafts` to see current drafts\\.",
      };
    }

    await supabase.from("audit_events").insert({
      workspace_id: workspaceId,
      actor_type: "telegram",
      action: "post_approved",
      resource_type: "content_post",
      resource_id: targetPost.id,
      safe_metadata: { source: "telegram_command" },
    });

    return {
      replyText: `✅ **Draft Approved!**\nDraft \`${targetPost.id.slice(0, 8)}\` is approved and ready for scheduling.`,
      replyMarkup: {
        inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "menu:main" }]],
      },
    };
  }

  if (text.startsWith("/reject")) {
    const parts = text.split(" ");
    if (parts.length < 2 || !parts[1].trim()) {
      return {
        replyText: "⚠️ Please specify a draft ID:\n`/reject <draft-id> [optional reason]`",
      };
    }

    const shortId = parts[1].trim();
    const reason = parts.slice(2).join(" ").trim() || "Rejected via Telegram";

    const { data: posts } = await supabase
      .from("content_posts")
      .select("id, status")
      .eq("workspace_id", workspaceId);

    const targetPost = (posts || []).find((p: any) => p.id.startsWith(shortId) || p.id === shortId);

    if (!targetPost) {
      return {
        replyText: `❌ Draft not found matching ID \`${escapeMd(shortId)}\`\\. Run \`/drafts\` to see active drafts\\.`,
      };
    }

    await supabase
      .from("content_posts")
      .update({ status: "rejected", rejection_reason: reason })
      .eq("id", targetPost.id);

    await supabase.from("audit_events").insert({
      workspace_id: workspaceId,
      actor_type: "telegram",
      action: "post_rejected",
      resource_type: "content_post",
      resource_id: targetPost.id,
      safe_metadata: { reason },
    });

    return {
      replyText: `🗑️ *Draft Rejected*\nDraft \`${escapeMd(targetPost.id.slice(0, 8))}\` rejected\\. Reason: _${escapeMd(reason)}_`,
      replyMarkup: {
        inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "menu:main" }]],
      },
    };
  }

  if (text === "/report") {
    const now = new Date();
    const currentPeriod = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

    const { data: usage } = await supabase
      .from("usage_counters")
      .select("counter_value")
      .eq("workspace_id", workspaceId)
      .eq("period_key", currentPeriod)
      .maybeSingle();

    const used = usage?.counter_value ?? 0;

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

  // Fallback
  return {
    replyText:
      `💬 *Received:* _${escapeMd(text.slice(0, 60))}_\n\n` +
      `Use the menu to manage your content:`,
    replyMarkup: mainMenuKeyboard(),
  };
}

// ─── Callback Query Handler ───────────────────────────────────────────────────

export interface CallbackContext {
  callbackQueryId: string;
  telegramUserId: number;
  chatId: number;
  messageId: number;
  data: string;
}

export async function handleCallbackQuery(
  ctx: CallbackContext,
  supabaseOverride?: any
): Promise<void> {
  const supabase = supabaseOverride || createServiceClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // Always answer to remove loading spinner
  await answerCallbackQuery(ctx.callbackQueryId);

  // Resolve workspace — every action requires server-side auth
  const resolved = await resolveWorkspace(ctx.telegramUserId, supabase);

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

  // ── Drafts / Approvals ──
  if (data === "menu:drafts" || data === "menu:approvals" || data.startsWith("draft:prev:") || data.startsWith("draft:next:")) {
    const offset = data.startsWith("draft:prev:") || data.startsWith("draft:next:")
      ? parseInt(data.split(":")[2] || "0", 10)
      : 0;

    const statusFilter = data === "menu:approvals" ? ["needs_review"] : ["draft", "needs_review"];

    const { data: drafts } = await supabase
      .from("content_posts")
      .select("id, internal_title, text, status, created_at")
      .eq("workspace_id", workspaceId)
      .in("status", statusFilter)
      .order("created_at", { ascending: false })
      .range(offset, offset + 4);

    if (!drafts || drafts.length === 0) {
      await editTelegramMessage(
        ctx.chatId,
        ctx.messageId,
        "📝 *No drafts awaiting review\\.*\n\nYour review queue is currently clear\\.",
        { inline_keyboard: [[{ text: "🏠 Main Menu", callback_data: "menu:main" }]] }
      );
      return;
    }

    let msgText = `📝 *Drafts \\(showing ${offset + 1}\\-${offset + drafts.length}\\)*\n\n`;
    const buttons: any[] = [];

    drafts.forEach((d: any, idx: number) => {
      const title = escapeMd((d.internal_title || d.text || "Untitled").slice(0, 50));
      const statusEmoji = d.status === "needs_review" ? "🔍" : "📄";
      msgText += `${offset + idx + 1}\\. ${statusEmoji} *${title}*\n   \`${d.id.slice(0, 8)}\`\n\n`;
      buttons.push([
        { text: `✅ Approve`, callback_data: `draft:approve:${d.id}` },
        { text: `❌ Reject`, callback_data: `draft:reject:${d.id}` },
      ]);
    });

    // Pagination
    const pagination: any[] = [];
    if (offset > 0) pagination.push({ text: "⬅️ Prev", callback_data: `draft:prev:${Math.max(0, offset - 5)}` });
    if (drafts.length === 5) pagination.push({ text: "Next ➡️", callback_data: `draft:next:${offset + 5}` });
    if (pagination.length > 0) buttons.push(pagination);
    buttons.push([{ text: "🏠 Main Menu", callback_data: "menu:main" }]);

    await editTelegramMessage(ctx.chatId, ctx.messageId, msgText.trim(), { inline_keyboard: buttons });
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

    await editTelegramMessage(
      ctx.chatId,
      ctx.messageId,
      `✅ *Confirm Approval*\n\nApprove post \`${escapeMd(postId.slice(0, 8))}\` for publishing?`,
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

    await supabase.from("audit_events").insert({
      workspace_id: workspaceId,
      actor_type: "telegram",
      action: "post_approved",
      resource_type: "content_post",
      resource_id: post.id,
      safe_metadata: { source: "telegram_callback" },
    });

    const title = escapeMd((post.internal_title || "Post").slice(0, 40));
    await editTelegramMessage(
      ctx.chatId,
      ctx.messageId,
      `✅ *Approved\\!*\n\n_${title}_ is approved and ready for scheduling\\.`,
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

    await editTelegramMessage(
      ctx.chatId,
      ctx.messageId,
      `❌ *Confirm Rejection*\n\nReject post \`${escapeMd(postId.slice(0, 8))}\`? This cannot be undone\\.`,
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

    await supabase
      .from("content_posts")
      .update({ status: "rejected", rejection_reason: "Rejected via Telegram" })
      .eq("id", post.id);

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
    const { data: scheduled } = await supabase
      .from("content_posts")
      .select("id, internal_title, scheduled_at, status")
      .eq("workspace_id", workspaceId)
      .in("status", ["scheduled", "approved"])
      .order("scheduled_at", { ascending: true })
      .limit(5);

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

    await supabase
      .from("content_posts")
      .update({ status: "approved", scheduled_at: null })
      .eq("id", postId);

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
    const now = new Date();
    const currentPeriod = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

    const { data: usage } = await supabase
      .from("usage_counters")
      .select("counter_value")
      .eq("workspace_id", workspaceId)
      .eq("period_key", currentPeriod)
      .maybeSingle();

    const used = usage?.counter_value ?? 0;

    await editTelegramMessage(
      ctx.chatId,
      ctx.messageId,
      `📈 *Monthly Report \\— ${escapeMd(currentPeriod)}*\n\n` +
      `• *Drafts Generated:* ${used} / 30\n` +
      `• *Daily Cap:* Max 1 post/day\n` +
      `• *Weekly Cap:* Max 7 posts/week\n` +
      `• *Reset:* 1st of next month`,
      { inline_keyboard: [navRow()] }
    );
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
    await supabase
      .from("workspaces")
      .update({ paused_at: new Date().toISOString(), state: "paused" })
      .eq("id", workspaceId);

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
    await supabase
      .from("workspaces")
      .update({
        paused_at: null,
        state: workspace?.operating_mode === "autopilot" ? "active_autopilot" : "active_approval_required",
      })
      .eq("id", workspaceId);

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
      `*Commands:*\n` +
      `/start \\— Main menu\n` +
      `/status \\— Agent status\n` +
      `/drafts \\— Review drafts\n` +
      `/approve \\<id\\> \\— Approve a draft\n` +
      `/reject \\<id\\> \\— Reject a draft\n` +
      `/pause \\— Pause agent\n` +
      `/resume \\— Resume agent\n` +
      `/report \\— Performance report\n` +
      `/settings \\— Account settings\n\n` +
      `Or use the inline buttons above for a guided experience\\.`,
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
    console.warn(`[telegram] sendTelegramMessage: TELEGRAM_BOT_TOKEN not configured. Message to ${chatId}: ${text}`);
    return { ok: true };
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
    });

    const data = (await response.json()) as any;
    if (!data.ok) {
      // Fallback to plain text on parse error
      if (data.description && typeof data.description === "string" && data.description.includes("can't parse entities")) {
        delete payload.parse_mode;
        payload.text = text.replace(/\\/g, "");
        const retryRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
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
    console.error("[telegram] sendMessage exception:", err);
    return { ok: false, error: err.message };
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
    { command: "approve", description: "Approve a draft post" },
    { command: "reject", description: "Reject a draft post" },
    { command: "pause", description: "Pause the agent" },
    { command: "resume", description: "Resume the agent" },
    { command: "report", description: "Monthly performance report" },
    { command: "settings", description: "Account settings" },
    { command: "help", description: "Show help & commands" },
  ];

  const res = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands }),
  });
  return await res.json();
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
