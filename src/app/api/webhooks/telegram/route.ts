/**
 * Telegram Bot Webhook Route Handler.
 *
 * Endpoint: POST /api/webhooks/telegram
 *
 * Security:
 * - Validates X-Telegram-Bot-Api-Secret-Token against TELEGRAM_WEBHOOK_SECRET.
 * - Deduplicates incoming update_id to prevent replay attacks.
 * - Executes commands tenant-scoped and fails closed.
 *
 * GET /api/webhooks/telegram
 * - Registers bot commands with Telegram's setMyCommands API.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  verifyTelegramSecret,
  isUpdateProcessed,
  markUpdateProcessed,
  handleTelegramMessage,
  handleCallbackQuery,
  sendTelegramMessage,
  registerBotCommands,
} from "@/lib/integrations/telegram/service";

export async function POST(req: NextRequest) {
  // 1. Verify Secret Token Header
  const secretHeader = req.headers.get("x-telegram-bot-api-secret-token");
  if (!verifyTelegramSecret(secretHeader)) {
    return NextResponse.json({ error: "Unauthorized: Invalid webhook secret token" }, { status: 401 });
  }

  try {
    const update = (await req.json()) as any;

    if (!update || typeof update !== "object") {
      return NextResponse.json({ ok: false, error: "Empty payload" }, { status: 400 });
    }

    const updateId = update.update_id;

    // 2. Replay attack prevention: Deduplicate update_id
    if (typeof updateId === "number") {
      if (isUpdateProcessed(updateId)) {
        return NextResponse.json({ ok: true, note: "Duplicate update skipped" });
      }
      markUpdateProcessed(updateId);
    }

    // 3. Handle callback_query (inline button presses)
    if (update.callback_query) {
      const cq = update.callback_query;
      if (cq.from && cq.message) {
        await handleCallbackQuery({
          callbackQueryId: cq.id,
          telegramUserId: cq.from.id,
          chatId: cq.message.chat.id,
          messageId: cq.message.message_id,
          data: cq.data || "",
        });
      }
      return NextResponse.json({ ok: true });
    }

    // 4. Handle message content (text commands)
    const message = update.message;
    if (message && message.from && message.chat && message.text) {
      const result = await handleTelegramMessage({
        telegramUserId: message.from.id,
        chatId: message.chat.id,
        text: message.text,
      });

      if (result.replyText) {
        await sendTelegramMessage(message.chat.id, result.replyText, result.replyMarkup);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[telegram-webhook] Error processing update:", err);
    // Return 200 to prevent Telegram retry spam on application-level error
    return NextResponse.json({ ok: true });
  }
}

/** GET /api/webhooks/telegram — registers bot slash commands with Telegram */
export async function GET(_req: NextRequest) {
  try {
    const result = await registerBotCommands();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
