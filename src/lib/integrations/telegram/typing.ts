/**
 * Keeps Telegram's native typing indicator visible while Nunuza is actively
 * processing a message or an asynchronous reply for that chat.
 *
 * Telegram typing actions expire after a few seconds, so refresh every 4s.
 * Failures are intentionally non-fatal: the underlying work must continue.
 */
const TYPING_REFRESH_MS = 4_000;

async function sendTypingAction(chatId: number): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !Number.isSafeInteger(chatId)) return;

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
      signal: AbortSignal.timeout(2_500),
    });
    const result = await response.json() as { ok?: boolean };
    if (!response.ok || result?.ok !== true) {
      console.warn("[telegram-typing] Telegram did not accept the typing indicator.");
    }
  } catch {
    console.warn("[telegram-typing] Could not refresh the typing indicator.");
  }
}

/**
 * Runs work while periodically refreshing Telegram's native typing status.
 * The indicator always stops when the work resolves or rejects.
 */
export async function withTelegramTyping<T>(
  chatId: number,
  work: () => Promise<T>
): Promise<T> {
  let active = true;
  let inFlight: Promise<void> | null = null;

  const pulse = (): void => {
    if (!active || inFlight) return;
    // Typing is best-effort UI only. Never make the actual job wait for
    // Telegram's chat-action endpoint to respond.
    inFlight = sendTypingAction(chatId).finally(() => {
      inFlight = null;
    });
  };

  pulse();
  const timer = setInterval(pulse, TYPING_REFRESH_MS);

  try {
    return await work();
  } finally {
    active = false;
    clearInterval(timer);
    // Do not await the final typing request; a slow Telegram API must not
    // delay job completion or prevent its durable attempt record from saving.
  }
}
