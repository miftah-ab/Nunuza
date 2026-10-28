/**
 * Polar Webhook Cryptographic Verification.
 *
 * Implements Standard Webhook HMAC-SHA256 verification (Svix / Polar standard).
 * Defends against replay attacks, payload tampering, and timing attacks.
 */

import { createHmac, timingSafeEqual } from "crypto";

const TOLERANCE_SECONDS = 300; // 5 minutes tolerance against replay attacks

export interface WebhookHeaders {
  id?: string | null;
  timestamp?: string | null;
  signature?: string | null;
}

/**
 * Extracts and decodes the webhook secret key.
 * If prefixed with 'whsec_', standard webhooks base64-decodes the secret.
 */
function getSecretBytes(secret: string): Buffer {
  if (secret.startsWith("whsec_")) {
    return Buffer.from(secret.slice(6), "base64");
  }
  return Buffer.from(secret, "utf-8");
}

/**
 * Verifies the incoming Polar webhook signature securely.
 *
 * @param rawBody - The unparsed raw JSON body string
 * @param headers - Object containing webhook-id, webhook-timestamp, webhook-signature
 * @param secretOverride - Optional secret for testing
 * @returns boolean indicating whether the webhook signature is authentic and within tolerance
 */
export function verifyPolarWebhookSignature(
  rawBody: string,
  headers: WebhookHeaders,
  secretOverride?: string
): boolean {
  const secret = secretOverride ?? process.env.POLAR_WEBHOOK_SECRET;
  if (!secret || secret.trim().length === 0 || secret.includes("your-polar")) {
    return false;
  }

  const webhookId = headers.id;
  const webhookTimestamp = headers.timestamp;
  const webhookSignature = headers.signature;

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return false;
  }

  // 1. Verify timestamp to defend against replay attacks
  const tsNum = parseInt(webhookTimestamp, 10);
  if (isNaN(tsNum)) {
    return false;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > TOLERANCE_SECONDS) {
    return false;
  }

  // 2. Compute expected HMAC
  const signedPayload = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const secretBytes = getSecretBytes(secret);
  const hmac = createHmac("sha256", secretBytes);
  hmac.update(signedPayload);
  const expectedBase64 = hmac.digest("base64");

  // 3. Compare signatures with timing-safe comparison
  // Webhook signature header may contain multiple signatures: "v1,signature1 v1,signature2"
  const passedSignatures = webhookSignature
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of passedSignatures) {
    let sigValue = part;
    if (part.startsWith("v1,")) {
      sigValue = part.slice(3);
    }

    try {
      const sigBuf = Buffer.from(sigValue, "base64");
      const expBuf = Buffer.from(expectedBase64, "base64");

      if (sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf)) {
        return true;
      }
    } catch {
      // Continue to check other signatures if any
    }
  }

  return false;
}
