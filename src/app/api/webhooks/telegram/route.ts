import { NextRequest, NextResponse } from "next/server";
import {
  verifyTelegramSecret,
  claimTelegramWebhookUpdate,
  completeTelegramWebhookUpdate,
  failTelegramWebhookUpdate,
  handleTelegramMessage,
  handleCallbackQuery,
  sendTelegramMessage,
  registerBotCommands,
} from "@/lib/integrations/telegram/service";
import { withTelegramTyping } from "@/lib/integrations/telegram/typing";

export async function POST(req: NextRequest) {
  if (!verifyTelegramSecret(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let updateId: number | undefined;
  let claimed = false;

  try {
    const update = (await req.json()) as Record<string, any>;
    if (!update || typeof update !== "object" || Array.isArray(update)) {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    const candidateUpdateId = update.update_id;
    if (
      typeof candidateUpdateId !== "number" ||
      !Number.isSafeInteger(candidateUpdateId) ||
      candidateUpdateId < 0
    ) {
      return NextResponse.json({ ok: false, error: "Invalid update_id" }, { status: 400 });
    }
    updateId = candidateUpdateId;

    const claim = await claimTelegramWebhookUpdate(updateId);
    if (claim === "completed") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    if (claim === "processing") {
      return NextResponse.json(
        { ok: false, retry: true, error: "Update is already being processed." },
        { status: 503, headers: { "Retry-After": "3" } }
      );
    }
    claimed = true;

    // Keep Telegram's native typing indicator visible during webhook work,
    // including database-backed commands and callback responses. Long-running
    // draft generation starts its own typing heartbeat in the queue consumer.
    const privateChat =
      update.callback_query?.message?.chat?.type === "private" ||
      update.message?.chat?.type === "private";
    const chatId = update.callback_query?.message?.chat?.id ?? update.message?.chat?.id;
    if (privateChat && Number.isSafeInteger(chatId)) {
      await withTelegramTyping(Number(chatId), async () => {
        // Nunuza is a private workspace control plane. Group and channel updates
        // are acknowledged but never allowed to read or mutate workspace data.
        if (update.callback_query?.from && update.callback_query?.message) {
          const cq = update.callback_query;
          if (cq.message.chat?.type === "private") {
            await handleCallbackQuery({
              callbackQueryId: cq.id,
              telegramUserId: cq.from.id,
              chatId: cq.message.chat.id,
              messageId: cq.message.message_id,
              data: cq.data || "",
              chatType: cq.message.chat.type,
            });
          }
        } else if (update.message?.from && update.message?.chat?.type === "private" && typeof update.message.text === "string") {
          const message = update.message;
          const result = await handleTelegramMessage({
            telegramUserId: message.from.id,
            chatId: message.chat.id,
            chatType: message.chat.type,
            updateId,
            text: message.text,
          });

          if (result.replyText) {
            const delivery = await sendTelegramMessage(message.chat.id, result.replyText, result.replyMarkup);
            if (!delivery.ok) {
              console.error("[telegram-webhook] Reply delivery failed for update", updateId, delivery.error || "unknown_error");
            }
          }
        }
      });
    }

    await completeTelegramWebhookUpdate(updateId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[telegram-webhook] Update processing failed:", err instanceof Error ? err.message : "Unknown error");
    if (claimed && updateId !== undefined) {
      try {
        await failTelegramWebhookUpdate(updateId);
      } catch {
        console.error("[telegram-webhook] Could not release failed update claim:", updateId);
      }
    }
    return NextResponse.json({ ok: false, retry: true }, { status: 500 });
  }
}

/** GET /api/webhooks/telegram — registers bot slash commands with Telegram. */
export async function GET(req: NextRequest) {
  if (!verifyTelegramSecret(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await registerBotCommands();
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not register Telegram commands." }, { status: 502 });
  }
}
