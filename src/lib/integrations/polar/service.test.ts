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
    const polarClient = new PolarClient({
      accessToken: "test-token",
      productId: "prod_nunuza_solo",
      priceId: "price_29_mo",
      server: "sandbox",
    });
    service = new PolarService(polarClient);
    dbTables = {
      billing_webhook_events: [],
      subscriptions: [],
      billing_customers: [],
      workspaces: [
        { id: WORKSPACE_ID, entitlement_type: "draft_only", access_mode: "commercial" },
        { id: OTHER_WORKSPACE_ID, entitlement_type: "draft_only", access_mode: "commercial" },
      ],
      audit_events: [],
    };

    mockSupabase = {
      from: vi.fn((table: string) => {
        const filters: Array<{ column: string; value: any }> = [];
        const query: any = {};
        query.select = vi.fn(() => query);
        query.eq = vi.fn((column: string, value: any) => {
          filters.push({ column, value });
          return query;
        });
        query.order = vi.fn(() => query);
        query.limit = vi.fn(() => query);
        query.maybeSingle = vi.fn(async () => {
          const found = (dbTables[table] || []).find((row) =>
            filters.every((filter) => row[filter.column] === filter.value)
          );
          return { data: found ? { ...found } : null, error: null };
        });
        query.single = vi.fn(async () => {
          const found = (dbTables[table] || []).find((row) =>
            filters.every((filter) => row[filter.column] === filter.value)
          );
          return { data: found ? { ...found } : null, error: null };
        });
        query.upsert = vi.fn(async (row: any, opts?: any) => {
          const list = dbTables[table] || (dbTables[table] = []);
          const conflictKey = opts?.onConflict || "id";
          const idx = list.findIndex((item) => item[conflictKey] === row[conflictKey]);
          if (idx >= 0) list[idx] = { ...list[idx], ...row };
          else list.push({ ...row });
          return { data: row, error: null };
        });
        query.update = vi.fn((updates: any) => ({
          eq: vi.fn(async (column: string, value: any) => {
            const list = dbTables[table] || [];
            for (const row of list) {
              if (row[column] === value) Object.assign(row, updates);
            }
            return { data: updates, error: null };
          }),
        }));
        query.insert = vi.fn(async (row: any) => {
          const list = dbTables[table] || (dbTables[table] = []);
          list.push({ ...row });
          return { data: row, error: null };
        });
        return query;
      }),
      rpc: vi.fn(async (name: string, args: any) => {
        if (name !== "claim_billing_webhook_event") {
          return { data: null, error: { message: "Unknown RPC" } };
        }
        const events = dbTables.billing_webhook_events;
        const existing = events.find((row) => row.provider_event_id === args.p_provider_event_id);
        if (!existing) {
          events.push({
            provider_event_id: args.p_provider_event_id,
            type: args.p_event_type,
            processing_status: "pending",
            processing_started_at: new Date().toISOString(),
            attempt_count: 1,
          });
          return { data: [{ claimed: true, reason: "CLAIMED" }], error: null };
        }
        if (["processed", "duplicate"].includes(existing.processing_status)) {
          return { data: [{ claimed: false, reason: "ALREADY_PROCESSED" }], error: null };
        }
        if (existing.processing_status === "pending") {
          return { data: [{ claimed: false, reason: "IN_PROGRESS" }], error: null };
        }
        existing.processing_status = "pending";
        existing.processing_started_at = new Date().toISOString();
        existing.attempt_count = (existing.attempt_count || 0) + 1;
        return { data: [{ claimed: true, reason: "RECLAIMED" }], error: null };
      }),
    };
  });

  it("maps Polar lifecycle dates and incomplete states fail-closed", () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    expect(service.mapPolarStatusToEntitlement("trialing", future, false, future)).toBe("paid_trial");
    expect(service.mapPolarStatusToEntitlement("trialing", future, false, past)).toBe("inactive");
    expect(service.mapPolarStatusToEntitlement("active", past, false, null)).toBe("inactive");
    expect(service.mapPolarStatusToEntitlement("active", future, false, null)).toBe("paid_active");
    expect(service.mapPolarStatusToEntitlement("past_due", past, false, null)).toBe("paid_active");
    expect(service.mapPolarStatusToEntitlement("canceled", future, true, null)).toBe("paid_active");
    expect(service.mapPolarStatusToEntitlement("canceled", future, false, null)).toBe("inactive");
    expect(service.mapPolarStatusToEntitlement("incomplete", null, false, null)).toBe("draft_only");
    expect(service.mapPolarStatusToEntitlement("revoked", null, false, null)).toBe("inactive");
  });

  it("asks Polar again before paid access and revokes an unpaid subscription", async () => {
    const polarClient = new PolarClient({
      accessToken: "test-token",
      productId: "prod_nunuza_solo",
      priceId: "price_29_mo",
      server: "sandbox",
    });
    vi.spyOn(polarClient, "getSubscription").mockResolvedValue({
      id: "sub_polar_100",
      status: "unpaid",
      product_id: "prod_nunuza_solo",
      price_id: "price_29_mo",
      customer_id: "cust_polar_1",
      current_period_start: null,
      current_period_end: null,
      trial_start: null,
      trial_end: null,
      cancel_at_period_end: false,
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
    } as any);
    service = new PolarService(polarClient);
    dbTables.workspaces[0].entitlement_type = "paid_active";
    dbTables.subscriptions.push({
      id: "sub-row-1",
      workspace_id: WORKSPACE_ID,
      polar_subscription_id: "sub_polar_100",
      product_id: "prod_nunuza_solo",
      price_id: "price_29_mo",
      status: "active",
      trial_start: null,
      trial_end: null,
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    });

    const entitlement = await service.getVerifiedWorkspaceEntitlement(WORKSPACE_ID, mockSupabase);
    expect(entitlement).toBe("inactive");
    expect(dbTables.workspaces[0].entitlement_type).toBe("inactive");
    expect(dbTables.subscriptions[0].provider_verified_at).toBeTruthy();
  });

  it("fails closed when the provider cannot verify a paid subscription", async () => {
    const polarClient = new PolarClient({
      accessToken: "test-token",
      productId: "prod_nunuza_solo",
      priceId: "price_29_mo",
      server: "sandbox",
    });
    vi.spyOn(polarClient, "getSubscription").mockRejectedValue(new Error("Polar unavailable"));
    service = new PolarService(polarClient);
    dbTables.workspaces[0].entitlement_type = "paid_active";
    dbTables.subscriptions.push({
      id: "sub-row-1",
      workspace_id: WORKSPACE_ID,
      polar_subscription_id: "sub_polar_100",
      product_id: "prod_nunuza_solo",
      price_id: "price_29_mo",
      status: "active",
    });

    await expect(service.getVerifiedWorkspaceEntitlement(WORKSPACE_ID, mockSupabase))
      .rejects.toThrow("Polar unavailable");
  });

  it("returns a retryable failure for a webhook event already being processed", async () => {
    dbTables.billing_webhook_events.push({
      provider_event_id: "evt_in_progress",
      type: "subscription.active",
      processing_status: "pending",
      processing_started_at: new Date().toISOString(),
    });
    const event: PolarWebhookEvent = {
      id: "evt_in_progress",
      type: "subscription.active",
      created_at: new Date().toISOString(),
      data: {} as any,
    };

    const result = await service.processWebhookEvent(event, mockSupabase);
    expect(result.status).toBe("failed");
    expect(result.reason).toContain("retry later");
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
        modified_at: new Date().toISOString(),
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
        modified_at: new Date().toISOString(),
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
        modified_at: new Date().toISOString(),
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
      provider_modified_at: "2026-10-28T12:00:00.000Z",
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
        modified_at: "2026-10-28T11:30:00.000Z",
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
        modified_at: new Date().toISOString(),
        metadata: { workspace_id: WORKSPACE_ID },
      },
    };

    const result = await service.processWebhookEvent(event, mockSupabase);
    expect(result.status).toBe("processed");

    const ws = dbTables.workspaces.find((w) => w.id === WORKSPACE_ID);
    expect(ws?.entitlement_type).toBe("inactive");
  });

  it("does not downgrade or overwrite a private beta tester workspace via Polar webhook", async () => {
    const BETA_WS_ID = "beta-workspace-uuid-1";
    dbTables.workspaces.push({
      id: BETA_WS_ID,
      owner_user_id: "user-beta-1",
      name: "Beta Tester Workspace",
      state: "active_approval_required",
      entitlement_type: "internal_beta",
      access_mode: "private_beta",
      operating_mode: "approval_required",
      paused_at: null,
      created_at: new Date().toISOString(),
      modified_at: new Date().toISOString(),
    });

    const event: PolarWebhookEvent = {
      id: "evt_polar_beta_safe_006",
      type: "subscription.canceled",
      created_at: new Date().toISOString(),
      data: {
        id: "sub_polar_999",
        status: "canceled",
        product_id: "prod_nunuza_solo",
        price_id: "price_29_mo",
        customer_id: "cust_polar_beta",
        customer: { id: "cust_polar_beta", email: "beta@nunuza.test" },
        current_period_start: new Date().toISOString(),
        current_period_end: new Date().toISOString(),
        trial_start: null,
        trial_end: null,
        cancel_at_period_end: false,
        canceled_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        modified_at: new Date().toISOString(),
        metadata: { workspace_id: BETA_WS_ID },
      },
    };

    const result = await service.processWebhookEvent(event, mockSupabase);
    expect(result.status).toBe("skipped");

    const ws = dbTables.workspaces.find((w) => w.id === BETA_WS_ID);
    expect(ws?.entitlement_type).toBe("internal_beta");
  });
});
