/**
 * Authorization unit tests.
 *
 * Tests the pure logic in src/lib/auth/workspace.ts that does NOT require
 * a real Supabase connection: entitlement checks, canPublish, canSchedule,
 * canUseAutopilot, assertEntitlement, assertEntitlementIn.
 *
 * Functions that require real DB access (requireAuth, requireWorkspace, etc.)
 * are integration tests in workspace.integration.test.ts — they remain
 * NOT VERIFIED until a real Supabase project is connected.
 *
 * Mocking policy: No Supabase mock is used here — only pure functions are tested.
 */

import { describe, it, expect } from "vitest";
import {
  entitlementPermits,
  assertEntitlement,
  assertEntitlementIn,
  canPublish,
  canSchedule,
  canUseAutopilot,
  EntitlementError,
  ForbiddenError,
  AuthError,
} from "@/lib/auth/workspace";
import type { EntitlementType, Workspace } from "@/types/database";

// ─── entitlementPermits ────────────────────────────────────────────────────────

describe("entitlementPermits()", () => {
  it("draft_only permits draft_only", () => {
    expect(entitlementPermits("draft_only", "draft_only")).toBe(true);
  });

  it("draft_only does NOT permit publishing_beta", () => {
    expect(entitlementPermits("draft_only", "publishing_beta")).toBe(false);
  });

  it("draft_only does NOT permit paid_trial", () => {
    expect(entitlementPermits("draft_only", "paid_trial")).toBe(false);
  });

  it("publishing_beta permits publishing_beta", () => {
    expect(entitlementPermits("publishing_beta", "publishing_beta")).toBe(true);
  });

  it("paid_active permits paid_trial (same level)", () => {
    expect(entitlementPermits("paid_active", "paid_trial")).toBe(true);
  });

  it("inactive does not permit draft_only", () => {
    expect(entitlementPermits("inactive", "draft_only")).toBe(false);
  });

  it("paid_active permits all lower levels", () => {
    const levels: EntitlementType[] = ["draft_only", "publishing_beta", "paid_trial"];
    levels.forEach((level) => {
      expect(entitlementPermits("paid_active", level)).toBe(true);
    });
  });
});

// ─── assertEntitlement ────────────────────────────────────────────────────────

describe("assertEntitlement()", () => {
  const ws = (e: EntitlementType): Pick<Workspace, "entitlement_type"> => ({
    entitlement_type: e,
  });

  it("does not throw when entitlement is sufficient", () => {
    expect(() => assertEntitlement(ws("paid_active"), "draft_only")).not.toThrow();
    expect(() => assertEntitlement(ws("publishing_beta"), "publishing_beta")).not.toThrow();
  });

  it("throws EntitlementError when entitlement is insufficient", () => {
    expect(() => assertEntitlement(ws("draft_only"), "publishing_beta")).toThrow(
      EntitlementError
    );
  });

  it("EntitlementError has code SUBSCRIPTION_INACTIVE", () => {
    try {
      assertEntitlement(ws("inactive"), "draft_only");
    } catch (e) {
      expect(e).toBeInstanceOf(EntitlementError);
      expect((e as EntitlementError).code).toBe("SUBSCRIPTION_INACTIVE");
    }
  });
});

// ─── assertEntitlementIn ──────────────────────────────────────────────────────

describe("assertEntitlementIn()", () => {
  const ws = (e: EntitlementType): Pick<Workspace, "entitlement_type"> => ({
    entitlement_type: e,
  });

  it("does not throw when entitlement is in the allowed list", () => {
    expect(() =>
      assertEntitlementIn(ws("paid_active"), ["paid_trial", "paid_active"])
    ).not.toThrow();
  });

  it("throws when entitlement is NOT in the allowed list", () => {
    expect(() =>
      assertEntitlementIn(ws("publishing_beta"), ["paid_trial", "paid_active"])
    ).toThrow(EntitlementError);
  });

  it("throws for draft_only even if publishing_beta is allowed", () => {
    expect(() =>
      assertEntitlementIn(ws("draft_only"), ["publishing_beta", "paid_active"])
    ).toThrow(EntitlementError);
  });
});

// ─── canPublish ───────────────────────────────────────────────────────────────

describe("canPublish()", () => {
  const cases: [EntitlementType, boolean][] = [
    ["draft_only",       false],  // NEVER — core spec rule
    ["inactive",         false],
    ["publishing_beta",  true],
    ["internal_test",    true],   // only for acceptance-test post
    ["paid_trial",       true],
    ["paid_active",      true],
  ];

  cases.forEach(([entitlement, expected]) => {
    it(`${entitlement} → canPublish = ${expected}`, () => {
      expect(canPublish({ entitlement_type: entitlement })).toBe(expected);
    });
  });

  it("draft_only NEVER returns true regardless of argument wrapping", () => {
    // Extra insurance against accidental truthy coercion
    const result = canPublish({ entitlement_type: "draft_only" });
    expect(result).toBe(false);
    expect(result).not.toBeTruthy();
  });
});

// ─── canSchedule ──────────────────────────────────────────────────────────────

describe("canSchedule()", () => {
  it("draft_only cannot schedule", () => {
    expect(canSchedule({ entitlement_type: "draft_only" })).toBe(false);
  });

  it("paid_active can schedule", () => {
    expect(canSchedule({ entitlement_type: "paid_active" })).toBe(true);
  });
});

// ─── canUseAutopilot ──────────────────────────────────────────────────────────

describe("canUseAutopilot()", () => {
  it("paid_active with autopilot mode can use Autopilot", () => {
    expect(
      canUseAutopilot({
        entitlement_type: "paid_active",
        operating_mode: "autopilot",
      })
    ).toBe(true);
  });

  it("paid_active with approval_required mode cannot use Autopilot", () => {
    expect(
      canUseAutopilot({
        entitlement_type: "paid_active",
        operating_mode: "approval_required",
      })
    ).toBe(false);
  });

  it("publishing_beta cannot use Autopilot even with autopilot mode", () => {
    expect(
      canUseAutopilot({
        entitlement_type: "publishing_beta",
        operating_mode: "autopilot",
      })
    ).toBe(false);
  });

  it("draft_only cannot use Autopilot", () => {
    expect(
      canUseAutopilot({
        entitlement_type: "draft_only",
        operating_mode: "autopilot",
      })
    ).toBe(false);
  });
});

// ─── Error class identity ─────────────────────────────────────────────────────

describe("Error classes", () => {
  it("AuthError has code AUTH_REQUIRED", () => {
    const e = new AuthError();
    expect(e.code).toBe("AUTH_REQUIRED");
    expect(e).toBeInstanceOf(Error);
  });

  it("ForbiddenError has code FORBIDDEN", () => {
    const e = new ForbiddenError();
    expect(e.code).toBe("FORBIDDEN");
  });

  it("EntitlementError has code SUBSCRIPTION_INACTIVE", () => {
    const e = new EntitlementError("paid_active", "draft_only");
    expect(e.code).toBe("SUBSCRIPTION_INACTIVE");
    expect(e.message).toContain("paid_active");
    expect(e.message).toContain("draft_only");
  });
});
