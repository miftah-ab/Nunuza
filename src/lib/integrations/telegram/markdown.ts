/**
 * Escapes text for Telegram MarkdownV2. Every message sent with
 * parse_mode MarkdownV2 must pass dynamic text through this, otherwise
 * Telegram rejects it and the user sees raw asterisks and backslashes.
 */
export function escapeMd(text: string): string {
  return String(text).replace(/[_*[\]()~`>#+=|{}.!\-\\]/g, "\\$&");
}
