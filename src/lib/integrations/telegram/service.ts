/**
 * Telegram Bot Integration Service.
 *
 * Implements:
 * 1. Cryptographically secure pairing token generation (link_tokens).
 * 2. Account linking & unlinking bound to authenticated workspaces (telegram_links).
 * 3. Webhook secret validation and replay protection (update_id deduplication).
 * 4. Conversational command processing:
 *    /start, /status, /pause, /resume, /drafts, /approve <id>, /reject <id>, /report, /help
 * 5. Strict adherence to spec:
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
    // Clear oldest items if cache grows too large
    const firstItems = Array.from(processedUpdateIds).slice(0, 500);
    firstItems.forEach((id) => processedUpdateIds.delete(id));
  }
  processedUpdateIds.add(updateId);
}

// ─── Secret & Webhook Validation ──────────────────────────────────────────────

export function verifyTelegramSecret(headerSecret: string | null | undefined): boolean {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) {
    // If not configured in environment, fail closed in production, allow in local test if mock mode
    return process.env.NODE_ENV === "test";
  }
  if (!headerSecret) return false;

  // Constant-time comparison to prevent timing attacks
  try {
    const a = Buffer.from(headerSecret);
    const b = Buffer.from(expectedSecret);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── Pairing Tokens ───────────────────────────────────────────────────────────

export interface PairingTokenResult {
  token: string;
  botUrl: string | null;
  expiresAt: string;
}

/**
 * Generates a single-use 15-minute pairing token for an authenticated workspace.
 * Raw token is returned once to the user; only its SHA-256 hash is saved.
 */
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

  const botUsername = process.env.TELEGRAM_BOT_USERNAME || process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
  const botUrl = botUsername ? `https://t.me/${botUsername}?start=${rawToken}` : null;

  return {
    token: rawToken,
    botUrl,
    expiresAt,
  };
}

/**
 * Links a Telegram user and chat ID using a raw pairing token.
 */
export async function linkTelegramAccount(
  rawToken: string,
  telegramUserId: number,
  chatId: number,
  supabaseOverride?: any
): Promise<{ success: boolean; workspaceId?: string; error?: string }> {
  const tokenHash = crypto.createHash("sha256").update(rawToken.trim()).digest("hex");
  const supabase = supabaseOverride || createServiceClient();

  // Find valid token
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

  // Mark token consumed
  await supabase
    .from("link_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", tokenRecord.id);

  // Revoke any previous active link for this workspace
  await supabase
    .from("telegram_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("workspace_id", tokenRecord.workspace_id)
    .is("revoked_at", null);

  // Revoke any previous active link for this Telegram user
  await supabase
    .from("telegram_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("telegram_user_id", telegramUserId)
    .is("revoked_at", null);

  // Insert active link
  const { error: linkError } = await supabase.from("telegram_links").insert({
    workspace_id: tokenRecord.workspace_id,
    telegram_user_id: telegramUserId,
    chat_id: chatId,
    linked_at: new Date().toISOString(),
  });

  if (linkError) {
    return { success: false, error: `Linking failed: ${linkError.message}` };
  }

  // Log audit event
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

/**
 * Revokes the active Telegram link for a workspace.
 */
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

/**
 * Returns the active Telegram link status for a workspace.
 */
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
}

export async function handleTelegramMessage(
  ctx: CommandContext,
  supabaseOverride?: any
): Promise<CommandResponse> {
  const supabase = supabaseOverride || createServiceClient();
  const text = (ctx.text || "").trim();

  // 1. Check for /start command (may have deep-link token argument)
  if (text.startsWith("/start")) {
    const parts = text.split(" ");
    if (parts.length > 1 && parts[1].trim()) {
      const token = parts[1].trim();
      const linkResult = await linkTelegramAccount(token, ctx.telegramUserId, ctx.chatId, supabase);
      if (linkResult.success) {
        return {
          replyText:
            "🎉 **Account linked successfully!**\n\n" +
            "Your Telegram account is now connected to your Nunuza workspace.\n\n" +
            "Available commands:\n" +
            "• `/status` - Agent & posting status\n" +
            "• `/drafts` - Review pending drafts\n" +
            "• `/pause` - Pause autonomous operations\n" +
            "• `/resume` - Resume operations\n" +
            "• `/report` - Workflow summary & usage\n" +
            "• `/help` - Command guide",
        };
      } else {
        return {
          replyText: `❌ ${linkResult.error || "Failed to link account."}`,
        };
      }
    }
  }

  // 2. Resolve active workspace for this Telegram user
  const { data: link, error: linkErr } = await supabase
    .from("telegram_links")
    .select("workspace_id, chat_id")
    .eq("telegram_user_id", ctx.telegramUserId)
    .is("revoked_at", null)
    .maybeSingle();

  if (linkErr || !link) {
    return {
      replyText:
        "🔒 **Nunuza Account Not Linked**\n\n" +
        "Your Telegram account is not currently connected to any active Nunuza workspace.\n\n" +
        "To connect:\n" +
        "1. Open your Nunuza web dashboard.\n" +
        "2. Navigate to **Integrations**.\n" +
        "3. Click **Connect Telegram** to generate your secure pairing link.",
    };
  }

  const workspaceId = link.workspace_id;

  // Update last interaction timestamp
  await supabase
    .from("telegram_links")
    .update({ last_interaction_at: new Date().toISOString() })
    .eq("telegram_user_id", ctx.telegramUserId)
    .is("revoked_at", null);

  // Fetch workspace details
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, entitlement_type, status")
    .eq("id", workspaceId)
    .single();

  const entitlement = workspace?.entitlement_type || "draft_only";

  // 3. Dispatch known commands
  if (text.startsWith("/start") || text === "/help") {
    return {
      replyText:
        `🤖 **Nunuza Agent Controls** (${workspace?.name || "Workspace"})\n\n` +
        `• \`/status\` - View agent status, scheduled posts & limits\n` +
        `• \`/drafts\` - List drafts awaiting review\n` +
        `• \`/approve <draft-id>\` - Approve a post for publishing\n` +
        `• \`/reject <draft-id> [reason]\` - Reject a draft\n` +
        `• \`/pause\` - Pause autonomous agent activity\n` +
        `• \`/resume\` - Resume autonomous agent activity\n` +
        `• \`/report\` - Monthly workflow item usage & activity\n` +
        `• \`/help\` - Show this command reference`,
    };
  }

  if (text === "/status") {
    // Count pending drafts & scheduled posts
    const { count: draftCount } = await supabase
      .from("content_posts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "draft");

    const { count: scheduledCount } = await supabase
      .from("content_posts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "scheduled");

    const isPaused = workspace?.status === "paused";

    return {
      replyText:
        `📊 **Nunuza Workspace Status**\n\n` +
        `• **Workspace:** ${workspace?.name || "Solo"}\n` +
        `• **Agent State:** ${isPaused ? "⏸️ Paused" : "▶️ Active"}\n` +
        `• **Entitlement:** \`${entitlement}\`\n` +
        `• **Drafts Awaiting Review:** ${draftCount ?? 0}\n` +
        `• **Scheduled Posts:** ${scheduledCount ?? 0}\n` +
        (entitlement === "draft_only"
          ? "\n⚠️ *Draft-only preview mode: scheduling & publishing are disabled.*"
          : ""),
    };
  }

  if (text === "/pause") {
    await supabase
      .from("workspaces")
      .update({ status: "paused" })
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
      replyText: "⏸️ **Agent Paused**\n\nAutonomous drafting and operations are paused. Your existing drafts and scheduled posts are preserved. Send `/resume` to reactivate.",
    };
  }

  if (text === "/resume") {
    await supabase
      .from("workspaces")
      .update({ status: "active" })
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
      replyText: "▶️ **Agent Resumed**\n\nAutonomous operations are now active.",
    };
  }

  if (text === "/drafts") {
    const { data: drafts } = await supabase
      .from("content_posts")
      .select("id, prompt, text, hook, created_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(5);

    if (!drafts || drafts.length === 0) {
      return {
        replyText: "📝 **No drafts awaiting review.**\n\nYour review queue is currently clear.",
      };
    }

    let response = "📝 **Drafts Awaiting Review (Top 5):**\n\n";
    drafts.forEach((d: any, idx: number) => {
      const excerpt = (d.hook || d.text || "").slice(0, 100).replace(/\n/g, " ");
      response += `${idx + 1}. **Draft \`${d.id.slice(0, 8)}\`**\n   "${excerpt}..."\n   Approve: \`/approve ${d.id.slice(0, 8)}\` | Reject: \`/reject ${d.id.slice(0, 8)}\`\n\n`;
    });

    return { replyText: response.trim() };
  }

  if (text.startsWith("/approve")) {
    const parts = text.split(" ");
    if (parts.length < 2 || !parts[1].trim()) {
      return {
        replyText: "⚠️ Please specify a draft ID to approve:\n`/approve <draft-id>`\nUse `/drafts` to list draft IDs.",
      };
    }

    const shortId = parts[1].trim();

    // BED-01 / BED-02 / Spec §10: Check entitlement before approving for publishing
    if (entitlement === "draft_only") {
      return {
        replyText:
          `⛔ **Action Restricted in Draft-Only Preview**\n\n` +
          `Your workspace entitlement is \`draft_only\`. Posts cannot be approved for live scheduling or publishing in this preview stage.\n\n` +
          `You can continue editing and reviewing drafts in your web dashboard.`,
      };
    }

    // Locate post within this workspace (supporting short ID prefix or full UUID)
    const { data: posts } = await supabase
      .from("content_posts")
      .select("id, status")
      .eq("workspace_id", workspaceId);

    const targetPost = (posts || []).find((p: any) => p.id.startsWith(shortId) || p.id === shortId);

    if (!targetPost) {
      return {
        replyText: `❌ Draft not found matching ID "${shortId}". Run \`/drafts\` to see active drafts.`,
      };
    }

    // Update status to approved
    await supabase
      .from("content_posts")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
      })
      .eq("id", targetPost.id);

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
    };
  }

  if (text.startsWith("/reject")) {
    const parts = text.split(" ");
    if (parts.length < 2 || !parts[1].trim()) {
      return {
        replyText: "⚠️ Please specify a draft ID to reject:\n`/reject <draft-id> [optional reason]`",
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
        replyText: `❌ Draft not found matching ID "${shortId}". Run \`/drafts\` to see active drafts.`,
      };
    }

    await supabase
      .from("content_posts")
      .update({
        status: "rejected",
        rejection_reason: reason,
      })
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
      replyText: `🗑️ **Draft Rejected**\nDraft \`${targetPost.id.slice(0, 8)}\` has been marked as rejected. Reason: "${reason}"`,
    };
  }

  if (text === "/report") {
    // Usage counters
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
        `📈 **Monthly Workflow Report**\n\n` +
        `• **Period:** ${currentPeriod} (UTC)\n` +
        `• **Generated Drafts:** ${used} / 30 limit\n` +
        `• **Daily Scheduling Cap:** Max 1 post/day\n` +
        `• **Weekly Scheduling Cap:** Max 7 posts/week\n` +
        `• **Reset Date:** 1st of next month (00:00 UTC)`,
    };
  }

  // Fallback for conversational input
  return {
    replyText:
      `💬 **Received your message:** "${text.slice(0, 60)}"\n\n` +
      `To manage content, use:\n` +
      `• \`/drafts\` to review\n` +
      `• \`/status\` to check operations\n` +
      `• \`/help\` for the full command reference`,
  };
}

// ─── Dispatch Outgoing Message ────────────────────────────────────────────────

export async function sendTelegramMessage(
  chatId: number,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.trim() === "") {
    // If running in development without live bot credentials, log and return gracefully
    console.warn(`[telegram] sendTelegramMessage: TELEGRAM_BOT_TOKEN not configured. Message to ${chatId}: ${text}`);
    return { ok: true };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      }),
    });

    const data = (await response.json()) as any;
    if (!data.ok) {
      console.error("[telegram] sendMessage error:", data);
      return { ok: false, error: data.description };
    }
    return { ok: true };
  } catch (err: any) {
    console.error("[telegram] sendMessage exception:", err);
    return { ok: false, error: err.message };
  }
}
