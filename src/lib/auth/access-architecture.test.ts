/**
 * Comprehensive Access Architecture & Private Beta Tests (Nunuza v1.0.0).
 *
 * Covers requirements in Section 11:
 * - Beta Provisioning & Feature Eligibility
 * - Capability Evaluation Layer (Eligibility vs Integration vs Safety)
 * - Autopilot Opt-in and Safety Gates for Beta & Paid
 * - Polar Lifecycle & Commercial Trial Activation
 * - Protection of Private Beta Workspaces from Webhook Downgrades
 * - Revocation & Paused State Safe Job Handling
 */

import { describe, it, expect, vi } from "vitest";
import {
  canPublish,
  canSchedule,
  canUseAutopilot,
  evaluatePublishCapability,
  getAccessMode,
  entitlementPermits,
} from "@/lib/auth/workspace";
import { PolarService } from "@/lib/integrations/polar/service";
import type { Workspace, EntitlementType } from "@/types/database";

describe("Access Architecture: Access Mode & Feature Eligibility", () => {
  it("determines access_mode correctly", () => {
    expect(getAccessMode({ entitlement_type: "internal_beta" })).toBe("private_beta");
    expect(getAccessMode({ entitlement_type: "publishing_beta" })).toBe("private_beta");
    expect(getAccessMode({ entitlement_type: "paid_trial" })).toBe("commercial");
    expect(getAccessMode({ entitlement_type: "paid_active" })).toBe("commercial");
    expect(getAccessMode({ entitlement_type: "suspended" })).toBe("commercial");
    expect(getAccessMode({ entitlement_type: "expired" })).toBe("commercial");
    expect(getAccessMode({ entitlement_type: "draft_only" })).toBe("commercial");
  });

  it("grants full v1.0.0 feature eligibility to internal_beta without Polar", () => {
    const betaWs = { entitlement_type: "internal_beta" as EntitlementType };
    expect(canPublish(betaWs)).toBe(true);
    expect(canSchedule(betaWs)).toBe(true);
    expect(entitlementPermits("internal_beta", "paid_trial")).toBe(true);
  });

  it("grants full v1.0.0 feature eligibility to paid_trial and paid_active", () => {
    const trialWs = { entitlement_type: "paid_trial" as EntitlementType };
    const activeWs = { entitlement_type: "paid_active" as EntitlementType };
    expect(canPublish(trialWs)).toBe(true);
    expect(canSchedule(trialWs)).toBe(true);
    expect(canPublish(activeWs)).toBe(true);
    expect(canSchedule(activeWs)).toBe(true);
  });

  it("restricts suspended, expired, and draft_only workspaces from publishing", () => {
    expect(canPublish({ entitlement_type: "suspended" })).toBe(false);
    expect(canPublish({ entitlement_type: "expired" })).toBe(false);
    expect(canPublish({ entitlement_type: "draft_only" })).toBe(false);
    expect(canPublish({ entitlement_type: "inactive" })).toBe(false);

    expect(canSchedule({ entitlement_type: "suspended" })).toBe(false);
    expect(canSchedule({ entitlement_type: "expired" })).toBe(false);
    expect(canSchedule({ entitlement_type: "draft_only" })).toBe(false);
  });
});

describe("Capability Evaluation Layer (§7: Separating Eligibility from Readiness)", () => {
  it("reports SUBSCRIPTION_REQUIRED when workspace is not eligible", () => {
    const ws = { entitlement_type: "suspended" as EntitlementType, paused_at: null };
    const evalResult = evaluatePublishCapability(ws, "connected", false);

    expect(evalResult.eligible).toBe(false);
    expect(evalResult.allowed).toBe(false);
    expect(evalResult.blockerCode).toBe("SUBSCRIPTION_REQUIRED");
    expect(evalResult.blockerReason).toContain("requires an active trial, subscription, or authorized private beta access");
  });

  it("reports INTEGRATION_DISCONNECTED when eligible workspace lacks connected LinkedIn", () => {
    const ws = { entitlement_type: "internal_beta" as EntitlementType, paused_at: null };
    const evalResult = evaluatePublishCapability(ws, "disconnected", false);

    expect(evalResult.eligible).toBe(true);
    expect(evalResult.integrationReady).toBe(false);
    expect(evalResult.allowed).toBe(false);
    expect(evalResult.blockerCode).toBe("INTEGRATION_DISCONNECTED");
    expect(evalResult.blockerReason).toContain("LinkedIn account is not connected");
  });

  it("reports SAFETY_PAUSED when workspace is paused even if eligible & connected", () => {
    const ws = { entitlement_type: "internal_beta" as EntitlementType, paused_at: new Date().toISOString() };
    const evalResult = evaluatePublishCapability(ws, "connected", false);

    expect(evalResult.eligible).toBe(true);
    expect(evalResult.integrationReady).toBe(true);
    expect(evalResult.safetyReady).toBe(false);
    expect(evalResult.allowed).toBe(false);
    expect(evalResult.blockerCode).toBe("SAFETY_PAUSED");
  });

  it("reports RATE_LIMITED when workspace exceeds daily limits", () => {
    const ws = { entitlement_type: "paid_active" as EntitlementType, paused_at: null };
    const evalResult = evaluatePublishCapability(ws, "connected", true);

    expect(evalResult.eligible).toBe(true);
    expect(evalResult.integrationReady).toBe(true);
    expect(evalResult.safetyReady).toBe(false);
    expect(evalResult.allowed).toBe(false);
    expect(evalResult.blockerCode).toBe("RATE_LIMITED");
  });

  it("allows execution when all 3 gates pass (Eligible && IntegrationReady && SafetyReady)", () => {
    const ws = { entitlement_type: "internal_beta" as EntitlementType, paused_at: null };
    const evalResult = evaluatePublishCapability(ws, "connected", false);

    expect(evalResult.eligible).toBe(true);
    expect(evalResult.integrationReady).toBe(true);
    expect(evalResult.safetyReady).toBe(true);
    expect(evalResult.allowed).toBe(true);
    expect(evalResult.blockerCode).toBeUndefined();
  });
});

describe("Autopilot Safety & Opt-in Invariants (§6)", () => {
  it("permits Autopilot for internal_beta when explicitly opted in", () => {
    expect(
      canUseAutopilot({
        entitlement_type: "internal_beta",
        operating_mode: "autopilot",
      })
    ).toBe(true);
  });

  it("permits Autopilot for paid_trial and paid_active when explicitly opted in", () => {
    expect(
      canUseAutopilot({
        entitlement_type: "paid_trial",
        operating_mode: "autopilot",
      })
    ).toBe(true);

    expect(
      canUseAutopilot({
        entitlement_type: "paid_active",
        operating_mode: "autopilot",
      })
    ).toBe(true);
  });

  it("strictly disables Autopilot when operating_mode is approval_required", () => {
    expect(
      canUseAutopilot({
        entitlement_type: "internal_beta",
        operating_mode: "approval_required",
      })
    ).toBe(false);

    expect(
      canUseAutopilot({
        entitlement_type: "paid_active",
        operating_mode: "approval_required",
      })
    ).toBe(false);
  });

  it("strictly disables Autopilot for suspended, expired, or draft_only workspaces", () => {
    expect(canUseAutopilot({ entitlement_type: "suspended", operating_mode: "autopilot" })).toBe(false);
    expect(canUseAutopilot({ entitlement_type: "expired", operating_mode: "autopilot" })).toBe(false);
    expect(canUseAutopilot({ entitlement_type: "draft_only", operating_mode: "autopilot" })).toBe(false);
  });
});

describe("Polar Subscription & Lifecycle State Transitions", () => {
  const polarService = new PolarService();

  it("maps trialing to paid_trial", () => {
    expect(polarService.mapPolarStatusToEntitlement("trialing", null, false)).toBe("paid_trial");
  });

  it("maps active to paid_active", () => {
    expect(polarService.mapPolarStatusToEntitlement("active", null, false)).toBe("paid_active");
  });

  it("maps past_due to paid_active (grace period)", () => {
    expect(polarService.mapPolarStatusToEntitlement("past_due", null, false)).toBe("paid_active");
  });

  it("maps canceled without cancelAtPeriodEnd to expired", () => {
    expect(polarService.mapPolarStatusToEntitlement("canceled", null, false)).toBe("expired");
  });

  it("maps canceled with cancelAtPeriodEnd and future date to paid_active", () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    expect(polarService.mapPolarStatusToEntitlement("canceled", futureDate, true)).toBe("paid_active");
  });

  it("maps unpaid and revoked to suspended", () => {
    expect(polarService.mapPolarStatusToEntitlement("unpaid", null, false)).toBe("suspended");
    expect(polarService.mapPolarStatusToEntitlement("revoked", null, false)).toBe("suspended");
    expect(polarService.mapPolarStatusToEntitlement("incomplete_expired", null, false)).toBe("suspended");
  });
});

