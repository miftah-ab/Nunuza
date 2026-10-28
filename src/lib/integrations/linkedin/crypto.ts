/**
 * Token Encryption & Decryption Helper for OAuth credentials.
 *
 * Uses AES-256-GCM authenticated encryption.
 * Encryption key is loaded from `LINKEDIN_TOKEN_ENCRYPTION_KEY` (32-byte hex).
 * Raw OAuth tokens are NEVER stored in plaintext in the database (BED-03).
 */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const hexKey = process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY;
  if (!hexKey || hexKey.trim().length < 64) {
    // If not configured or test fallback, derive deterministic key from a fallback
    // In production, wrangler secret or .env.local must provide 64 hex chars (32 bytes)
    const fallbackSeed = hexKey || "nunuza_default_encryption_key_development_only_32_bytes!!";
    return crypto.createHash("sha256").update(fallbackSeed).digest();
  }
  return Buffer.from(hexKey.trim(), "hex");
}

export interface EncryptedData {
  encrypted: string; // hex
  iv: string;        // hex
  tag: string;       // hex
}

/**
 * Encrypts a plaintext OAuth token into an encrypted reference string.
 * Output format: `iv:tag:ciphertext` (all hex encoded)
 */
export function encryptToken(token: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(token, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts an encrypted token reference string.
 * Returns the plaintext token or throws on authentication/tampering failure.
 */
export function decryptToken(encryptedRef: string): string {
  const parts = encryptedRef.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token reference format.");
  }

  const [ivHex, tagHex, encryptedHex] = parts;
  const key = getKey();
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
