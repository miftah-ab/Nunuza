import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { verifyPolarWebhookSignature } from "./crypto";
import { PolarClient } from "./client";
import { PolarService } from "./service";
import type { PolarWebhookEvent } from "./types";

describe("Polar Webhook Cryptographic Verification", () => {
  const secret = "test_webhook_secret_key_12345";
  const rawBody = JSON.stringify({ id: "evt_123", type: "subscription.created" });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const webhookId = "msg_polar_001";

  function createSignature(body: string, ts: string, id: string, key: string) {
    const payload = `${id}.${ts}.${body}`;
    const hmac = createHmac("sha256", Buffer.from(key, "utf-8"));
    hmac.update(payload);
    return `v1,${hmac.digest("base64")}`;
  }

  it("verifies authentic webhook signature within tolerance", () => {
    const sig = createSignature(rawBody, timestamp, webhookId, secret);
    const valid = verifyPolarWebhookSignature(
      rawBody,
      { id: webhookId, timestamp, signature: sig },
      secret
    );
    expect(valid).toBe(true);
  });

  it("supports whsec_ base64 decoded secrets", () => {
    const rawKey = "12345678901234567890123456789012";
    const base64Key = Buffer.from(rawKey, "utf-8").toString("base64");
    const whsecKey = `whsec_${base64Key}`;

    const payload = `${webhookId}.${timestamp}.${rawBody}`;
    const hmac = createHmac("sha256", Buffer.from(rawKey, "utf-8"));
    hmac.update(payload);
    const sig = `v1,${hmac.digest("base64")}`;

    const valid = verifyPolarWebhookSignature(
      rawBody,
      { id: webhookId, timestamp, signature: sig },
      whsecKey
    );
    expect(valid).toBe(true);
  });

  it("rejects tampered webhook body", () => {
    const sig = createSignature(rawBody, timestamp, webhookId, secret);
    const tamperedBody = JSON.stringify({ id: "evt_123", type: "subscription.created", tampered: true });
    const valid = verifyPolarWebhookSignature(
      tamperedBody,
      { id: webhookId, timestamp, signature: sig },
      secret
    );
    expect(valid).toBe(false);
  });

  it("rejects invalid webhook secret", () => {
    const sig = createSignature(rawBody, timestamp, webhookId, "wrong_secret");
    const valid = verifyPolarWebhookSignature(
      rawBody,
      { id: webhookId, timestamp, signature: sig },
      secret
    );
    expect(valid).toBe(false);
  });

  it("rejects expired timestamps (> 300s old)", () => {
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 400).toString();
    const sig = createSignature(rawBody, oldTimestamp, webhookId, secret);
    const valid = verifyPolarWebhookSignature(
      rawBody,
      { id: webhookId, timestamp: oldTimestamp, signature: sig },
      secret
    );
    expect(valid).toBe(false);
  });

  it("rejects missing headers", () => {
    expect(verifyPolarWebhookSignature(rawBody, { timestamp, signature: "v1,abc" }, secret)).toBe(false);
    expect(verifyPolarWebhookSignature(rawBody, { id: webhookId, signature: "v1,abc" }, secret)).toBe(false);
    expect(verifyPolarWebhookSignature(rawBody, { id: webhookId, timestamp }, secret)).toBe(false);
  });
});

describe("Polar Client & Seller Eligibility", () => {
  it("blocks checkout when seller eligibility gate has not passed (BED-08)", async () => {
    const client = new PolarClient({
      accessToken: "polar_test_token",
      productId: "prod_123",
      priceId: "price_123",
    });

    vi.spyOn(client, "isSellerEligible").mockReturnValue(false);

    await expect(
      client.createCheckoutSession({
        workspaceId: "ws_001",
        userEmail: "founder@example.com",
        successUrl: "http://localhost:3000/success",
      })
    ).rejects.toThrow(/SELLER_INELIGIBLE/i);
  });

  it("blocks checkout when Polar credentials or prices are unconfigured", async () => {
    const client = new PolarClient({
      accessToken: "",
      productId: "",
      priceId: "",
    });

    await expect(
      client.createCheckoutSession({
        workspaceId: "ws_001",
        userEmail: "founder@example.com",
        successUrl: "http://localhost:3000/success",
      })
    ).rejects.toThrow(/BILLING_UNCONFIGURED/i);
  });
});

describe("Polar Subscription Lifecycle & Entitlement Reconciliation", () => {
  let service: PolarService;
  let mockSupabase: any;
  let dbTables: Record<string, any[]>;

  const WORKSPACE_ID = "ws_test_tenant_a";
  const OTHER_WORKSPACE_ID = "ws_test_tenant_b";

  beforeEach(() => {
    service = new PolarService();
    dbTables = {
      billing_webhook_events: [],
      subscriptions: [],
      billing_customers: [],
      workspaces: [
        { id: WORKSPACE_ID, entitlement_type: "draft_only" },
        { id: OTHER_WORKSPACE_ID, entitlement_type: "draft_only" },
      ],
      audit_events: [],
    };

    mockSupabase = {
      from: vi.fn((table: string) => {
        return {
          select: vi.fn((columns?: string) => ({
            eq: vi.fn((col: string, val: any) => ({
              maybeSingle: vi.fn(async () => {
                const found = dbTables[table]?.find((r) => r[col] === val);
                return { data: found ? { ...found } : null, error: null };
              }),
              single: vi.fn(async () => {
                const found = dbTables[table]?.find((r) => r[col] === val);
                return { data: found ? { ...found } : null, error: null };
              }),
            })),
          })),
          upsert: vi.fn(async (row: any, opts?: any) => {
            const list = dbTables[table] || (dbTables[table] = []);
            const conflictKey = opts?.onConflict || "id";
            const idx = list.findIndex((r) => r[conflictKey] === row[conflictKey]);
            if (idx >= 0) {
              list[idx] = { ...list[idx], ...row };
            } else {
              list.push({ ...row });
            }
            return { data: row, error: null };
          }),
          update: vi.fn((updates: any) => ({
            eq: vi.fn(async (col: string, val: any) => {
              const list = dbTables[table] || [];
              for (const r of list) {
                if (r[col] === val) {
                  Object.assign(r, updates);
                }
              }
              return { data: updates, error: null };
            }),
          })),
          insert: vi.fn(async (row: any) => {
            dbTables[table]?.push(row);
            return { data: row, error: null };
          }),
        };
      }),
    };
  });

  it("processes subscription.created with trialing -> elevates entitlement to paid_trial", async () => {
    const event: PolarWebhookEvent = {
      id: "evt_sub_created_001",
      type: "subscription.created",
      created_at: new Date().toISOString(),
      data: {
        id: "sub_polar_100",
        status: "trialing",
        product_id: "prod_nunuza_solo",
        price_id: "price_29_mo",
        customer_id: "cust_polar_1",
        customer: { id: "cust_polar_1", email: "founder@nunuza.test" },
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 14 * 86400000).toISOString(),
        trial_start: new Date().toISOString(),
        trial_end: new Date(Date.now() + 14 * 86400000).toISOString(),
        cancel_at_period_end: false,
        canceled_at: null,
        ended_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: { workspace_id: WORKSPACE_ID },
      },
    };

    const result = await service.processWebhookEvent(event, mockSupabase);
    expect(result.status).toBe("processed");

    // Target workspace elevated to paid_trial
    const ws = dbTables.workspaces.find((w) => w.id === WORKSPACE_ID);
    expect(ws?.entitlement_type).toBe("paid_trial");

    // Other workspace strictly unchanged (tenant isolation)
    const otherWs = dbTables.workspaces.find((w) => w.id === OTHER_WORKSPACE_ID);
    expect(otherWs?.entitlement_type).toBe("draft_only");

    // Subscriptions record recorded
    const sub = dbTables.subscriptions.find((s) => s.polar_subscription_id === "sub_polar_100");
    expect(sub?.status).toBe("trialing");
    expect(sub?.entitlement_snapshot).toBe("paid_trial");
  });

  it("processes subscription.active -> elevates entitlement to paid_active", async () => {
    const event: PolarWebhookEvent = {
      id: "evt_sub_active_002",
      type: "subscription.active",
      created_at: new Date().toISOString(),
      data: {
        id: "sub_polar_100",
        status: "active",
        product_id: "prod_nunuza_solo",
        price_id: "price_29_mo",
        customer_id: "cust_polar_1",
        customer: { id: "cust_polar_1", email: "founder@nunuza.test" },
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
        trial_start: null,
        trial_end: null,
        cancel_at_period_end: false,
        canceled_at: null,
        ended_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: { workspace_id: WORKSPACE_ID },
      },
    };

    const result = await service.processWebhookEvent(event, mockSupabase);
    expect(result.status).toBe("processed");

    const ws = dbTables.workspaces.find((w) => w.id === WORKSPACE_ID);
    expect(ws?.entitlement_type).toBe("paid_active");
  });

  it("handles duplicate webhook events idempotently", async () => {
    const event: PolarWebhookEvent = {
      id: "evt_duplicate_003",
      type: "subscription.active",
      created_at: new Date().toISOString(),
      data: {
        id: "sub_polar_100",
        status: "active",
        product_id: "prod_nunuza_solo",
        price_id: "price_29_mo",
        customer_id: "cust_polar_1",
        customer: { id: "cust_polar_1", email: "founder@nunuza.test" },
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
        trial_start: null,
        trial_end: null,
        cancel_at_period_end: false,
        canceled_at: null,
        ended_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: { workspace_id: WORKSPACE_ID },
      },
    };

    // First delivery
    const res1 = await service.processWebhookEvent(event, mockSupabase);
    expect(res1.status).toBe("processed");

    // Second duplicate delivery
    const res2 = await service.processWebhookEvent(event, mockSupabase);
    expect(res2.status).toBe("duplicate");
  });

  it("safely skips out-of-order stale events without regressing subscription state", async () => {
    // Current subscription updated at 12:00
    dbTables.subscriptions.push({
      workspace_id: WORKSPACE_ID,
      polar_subscription_id: "sub_polar_100",
      status: "active",
      updated_at: "2026-10-28T12:00:00.000Z",
    });
    dbTables.workspaces[0].entitlement_type = "paid_active";

    // Stale event from 11:30
    const staleEvent: PolarWebhookEvent = {
      id: "evt_stale_004",
      type: "subscription.updated",
      created_at: "2026-10-28T11:30:00.000Z",
      data: {
        id: "sub_polar_100",
        status: "trialing",
        product_id: "prod_nunuza_solo",
        price_id: "price_29_mo",
        customer_id: "cust_polar_1",
        customer: { id: "cust_polar_1", email: "founder@nunuza.test" },
        current_period_start: new Date().toISOString(),
        current_period_end: new Date().toISOString(),
        trial_start: null,
        trial_end: null,
        cancel_at_period_end: false,
        canceled_at: null,
        ended_at: null,
        created_at: "2026-10-28T11:30:00.000Z",
        updated_at: "2026-10-28T11:30:00.000Z",
        metadata: { workspace_id: WORKSPACE_ID },
      },
    };

    const res = await service.processWebhookEvent(staleEvent, mockSupabase);
    expect(res.status).toBe("skipped");

    // Workspace remains paid_active (does not regress to trialing)
    const ws = dbTables.workspaces.find((w) => w.id === WORKSPACE_ID);
    expect(ws?.entitlement_type).toBe("paid_active");
  });

  it("handles subscription.revoked -> transitions entitlement to inactive", async () => {
    const event: PolarWebhookEvent = {
      id: "evt_revoked_005",
      type: "subscription.revoked",
      created_at: new Date().toISOString(),
      data: {
        id: "sub_polar_100",
        status: "revoked",
        product_id: "prod_nunuza_solo",
        price_id: "price_29_mo",
        customer_id: "cust_polar_1",
        customer: { id: "cust_polar_1", email: "founder@nunuza.test" },
        current_period_start: new Date().toISOString(),
        current_period_end: new Date().toISOString(),
        trial_start: null,
        trial_end: null,
        cancel_at_period_end: false,
        canceled_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: { workspace_id: WORKSPACE_ID },
      },
    };

    const result = await service.processWebhookEvent(event, mockSupabase);
    expect(result.status).toBe("processed");

    const ws = dbTables.workspaces.find((w) => w.id === WORKSPACE_ID);
    expect(ws?.entitlement_type).toBe("inactive");
  });
});
