import { describe, expect, it } from "vitest";
import { normalizePolarWebhookEvent } from "./webhook";

describe("normalizePolarWebhookEvent", () => {
  it("uses Polar's webhook-id header and top-level timestamp", () => {
    const event = normalizePolarWebhookEvent({
      type: "subscription.active",
      timestamp: "2026-11-15T05:00:00.000Z",
      data: { id: "sub_123", status: "active" },
    }, "wh_123");

    expect(event).toEqual({
      id: "wh_123",
      type: "subscription.active",
      created_at: "2026-11-15T05:00:00.000Z",
      data: { id: "sub_123", status: "active" },
    });
  });

  it("accepts the legacy created_at timestamp field", () => {
    const event = normalizePolarWebhookEvent({
      type: "subscription.updated",
      created_at: "2026-11-15T05:00:00.000Z",
      data: { id: "sub_123" },
    }, "wh_124");
    expect(event.created_at).toBe("2026-11-15T05:00:00.000Z");
  });

  it("rejects missing delivery ids and malformed payloads", () => {
    expect(() => normalizePolarWebhookEvent({ type: "subscription.active", timestamp: "2026-11-15T05:00:00Z", data: {} }, null)).toThrow(/webhook id/i);
    expect(() => normalizePolarWebhookEvent({ type: "subscription.active", timestamp: "not-a-date", data: {} }, "wh_1")).toThrow(/timestamp/i);
    // Polar can deliver unrelated event families to the same endpoint; the
    // service must acknowledge and ignore them rather than trigger retries.
    expect(normalizePolarWebhookEvent({ type: "customer.updated", timestamp: "2026-11-15T05:00:00Z", data: {} }, "wh_1").type).toBe("customer.updated");
    expect(() => normalizePolarWebhookEvent({ type: "", timestamp: "2026-11-15T05:00:00Z", data: {} }, "wh_1")).toThrow(/event type/i);
  });
});
