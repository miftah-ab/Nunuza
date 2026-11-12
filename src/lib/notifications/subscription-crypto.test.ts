import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSubscriptionValue, encryptSubscriptionValue, hashSubscriptionEndpoint } from "./subscription-crypto";

const originalKey = process.env.WEB_PUSH_SUBSCRIPTION_ENCRYPTION_KEY;

describe("push subscription encryption", () => {
  beforeEach(() => {
    process.env.WEB_PUSH_SUBSCRIPTION_ENCRYPTION_KEY = "a".repeat(64);
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.WEB_PUSH_SUBSCRIPTION_ENCRYPTION_KEY;
    else process.env.WEB_PUSH_SUBSCRIPTION_ENCRYPTION_KEY = originalKey;
  });

  it("encrypts and decrypts subscription secrets without storing plaintext", async () => {
    const secret = "https://fcm.googleapis.com/fcm/send/private-endpoint-token";
    const encrypted = await encryptSubscriptionValue(secret);
    expect(encrypted).not.toContain(secret);
    expect(await decryptSubscriptionValue(encrypted)).toBe(secret);
  });

  it("uses a fresh nonce for each encryption", async () => {
    const first = await encryptSubscriptionValue("same-value");
    const second = await encryptSubscriptionValue("same-value");
    expect(first).not.toBe(second);
    expect(await decryptSubscriptionValue(first)).toBe("same-value");
    expect(await decryptSubscriptionValue(second)).toBe("same-value");
  });

  it("hashes the endpoint deterministically without exposing it", async () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/private-endpoint-token";
    const hash = await hashSubscriptionEndpoint(endpoint);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(endpoint);
    expect(await hashSubscriptionEndpoint(endpoint)).toBe(hash);
  });

  it("rejects an invalid encryption key", async () => {
    process.env.WEB_PUSH_SUBSCRIPTION_ENCRYPTION_KEY = "invalid";
    await expect(encryptSubscriptionValue("secret")).rejects.toThrow("Notification encryption key is not configured.");
  });
});
