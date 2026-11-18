/**
 * Verifies the `initData` that Telegram gives a Mini App, so the reader and its
 * approve/reject actions can trust who is calling without a Nunuza login.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */

export interface TelegramWebAppUser {
  id: number;
  firstName?: string;
}

const MAX_AGE_SECONDS = 24 * 60 * 60;

async function hmac(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Returns the verified Telegram user, or null if the data is forged, malformed or too old. */
export async function verifyWebAppInitData(
  initData: string,
  botToken: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<TelegramWebAppUser | null> {
  if (!initData || initData.length > 4096 || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
  const secretKey = await hmac(new TextEncoder().encode("WebAppData"), botToken);
  const expected = toHex(await hmac(secretKey, dataCheckString));
  if (!timingSafeEqual(expected, hash.toLowerCase())) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || authDate > nowSeconds + 60 || nowSeconds - authDate > MAX_AGE_SECONDS) return null;

  try {
    const user = JSON.parse(params.get("user") || "");
    if (typeof user?.id !== "number" || !Number.isSafeInteger(user.id)) return null;
    return { id: user.id, firstName: typeof user.first_name === "string" ? user.first_name : undefined };
  } catch {
    return null;
  }
}
