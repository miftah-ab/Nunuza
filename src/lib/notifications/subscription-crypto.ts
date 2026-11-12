const encoder = new TextEncoder();

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
const decoder = new TextDecoder();

function keyBytes(): Uint8Array {
  const value = process.env.WEB_PUSH_SUBSCRIPTION_ENCRYPTION_KEY || "";
  if (!/^[0-9a-fA-F]{64}$/.test(value)) throw new Error("Notification encryption key is not configured.");
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
}
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function hashSubscriptionEndpoint(endpoint: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bufferSource(encoder.encode(endpoint))));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function encryptSubscriptionValue(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", bufferSource(keyBytes()), "AES-GCM", false, ["encrypt"]);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: bufferSource(iv) }, key, bufferSource(encoder.encode(value))));
  return toBase64Url(new Uint8Array([...iv, ...encrypted]));
}
export async function decryptSubscriptionValue(value: string): Promise<string> {
  const bytes = fromBase64Url(value);
  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);
  const key = await crypto.subtle.importKey("raw", bufferSource(keyBytes()), "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bufferSource(iv) }, key, bufferSource(ciphertext));
  return decoder.decode(plaintext);
}
