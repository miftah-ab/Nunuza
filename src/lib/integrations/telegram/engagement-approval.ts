import { createServiceClient } from "@/lib/supabase/server";
import { answerCallbackQuery, editTelegramMessage } from "./service";

export async function handleEngagementApprovalCallback(input: {
  callbackQueryId: string; telegramUserId: number; chatId: number; messageId: number; data: string;
}): Promise<boolean> {
  const match = /^eng:(approve|reject):([0-9a-f-]{36})$/i.exec(input.data);
  if (!match) return false;
  const [, decision, actionId] = match;
  const db = createServiceClient();
  const rpc = decision === "approve"
    ? "approve_engagement_action_telegram"
    : "reject_engagement_action_telegram";
  const { data, error } = await db.rpc(rpc, {
    p_action_id: actionId,
    p_telegram_user_id: input.telegramUserId,
    p_chat_id: input.chatId,
  });
  if (error || data !== true) {
    await answerCallbackQuery(input.callbackQueryId, "This approval is expired or no longer available.");
    return true;
  }
  await answerCallbackQuery(input.callbackQueryId, decision === "approve" ? "Reply approved." : "Reply rejected.");
  await editTelegramMessage(
    input.chatId,
    input.messageId,
    decision === "approve"
      ? "Reply approved. Nunuza will publish it only if LinkedIn has granted the required comment permission."
      : "Reply rejected. Nunuza will not publish it."
  );
  return true;
}
