import type { PolarWebhookEvent, PolarWebhookEventType } from "./types";

type PolarWebhookPayload = {
  type?: unknown;
  timestamp?: unknown;
  created_at?: unknown;
  data?: unknown;
};

/**
 * Polar identifies the delivery with the webhook-id header and timestamps
 * the event with the top-level timestamp field. Normalize these into the
 * service's id/created_at contract.
 */
export function normalizePolarWebhookEvent(
  payload: unknown,
  webhookId: string | null
): PolarWebhookEvent {
  if (!webhookId || webhookId.length > 255) {
    throw new Error("Polar webhook id header is missing or invalid.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Polar webhook payload must be an object.");
  }

  const value = payload as PolarWebhookPayload;
  if (typeof value.type !== "string" || (!value.type.startsWith("subscription.") && !value.type.startsWith("checkout."))) {
    throw new Error("Polar webhook event type is invalid.");
  }
  if (!value.data || typeof value.data !== "object" || Array.isArray(value.data)) {
    throw new Error("Polar webhook event data is invalid.");
  }

  const timestamp = typeof value.timestamp === "string"
    ? value.timestamp
    : typeof value.created_at === "string"
      ? value.created_at
      : null;
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) {
    throw new Error("Polar webhook timestamp is invalid.");
  }

  return {
    id: webhookId,
    type: value.type as PolarWebhookEventType,
    created_at: timestamp,
    data: value.data as PolarWebhookEvent["data"],
  };
}
