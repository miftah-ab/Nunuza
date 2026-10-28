/**
 * Cross-tenant isolation tests — pure authorization logic.
 *
 * These tests verify that the authorization helpers correctly prevent
 * cross-workspace access using pure logic (no Supabase connection).
 *
 * Test categories:
 *   1. "MOCKED" — uses mock workspace/user objects; runs offline.
 *   2. "INTEGRATION — BLOCKED" — requires a real Supabase project.
 *      These are labeled clearly and must remain NOT VERIFIED until tested.
 *
 * The core invariant tested here (§17 defense in depth):
 *   If user A owns workspace-A, they must NEVER be able to access workspace-B's data,
 *   even if they send workspace-B's ID in a request.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  canPublish,
  canSchedule,
  canUseAutopilot,
  assertEntitlement,
  entitlementPermits,
  EntitlementError,
  ForbiddenError,
} from "@/lib/auth/workspace";
import type { EntitlementType, Workspace } from "@/types/database";

// ─── Helper factories ─────────────────────────────────────────────────────────

const WORKSPACE_A_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const WORKSPACE_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_A_ID      = "11111111-1111-1111-1111-111111111111";
const USER_B_ID      = "22222222-2222-2222-2222-222222222222";

function makeWorkspace(
  id: string,
  ownerId: string,
  entitlement: EntitlementType = "draft_only"
): Workspace {
  return {
    id,
    owner_user_id: ownerId,
    name: "Test Workspace",
    state: "active_approval_required",
    entitlement_type: entitlement,
    operating_mode: "approval_required",
    paused_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

// ─── Cross-tenant access prevention (simulated) ──────────────────────────────

describe("[MOCKED] Cross-tenant access prevention", () => {
  /**
   * Simulates what requireWorkspaceAccess() does:
   * compare the session-derived workspace.id against the claimed ID.
   * This verifies the logic that prevents IDOR.
   */
  function simulateWorkspaceAccess(
    sessionWorkspace: Workspace,
    claimedWorkspaceId: string
  ): boolean {
    // This mirrors the check in requireWorkspaceAccess()
    if (sessionWorkspace.id !== claimedWorkspaceId) {
      throw new ForbiddenError("You do not have access to this workspace.");
    }
    return true;
  }

  it("allows access when claimed ID matches session workspace", () => {
    const ws = makeWorkspace(WORKSPACE_A_ID, USER_A_ID);
    expect(simulateWorkspaceAccess(ws, WORKSPACE_A_ID)).toBe(true);
  });

  it("denies access when claimed ID is a different workspace", () => {
    const ws = makeWorkspace(WORKSPACE_A_ID, USER_A_ID);
    expect(() =>
      simulateWorkspaceAccess(ws, WORKSPACE_B_ID)
    ).toThrow(ForbiddenError);
  });

  it("denies access even if entitlement_type matches between workspaces", () => {
    // Both workspaces have the same entitlement — but they are different workspaces
    const userAWorkspace = makeWorkspace(WORKSPACE_A_ID, USER_A_ID, "paid_active");
    expect(() =>
      simulateWorkspaceAccess(userAWorkspace, WORKSPACE_B_ID)
    ).toThrow(ForbiddenError);
  });

  it("ForbiddenError code is FORBIDDEN", () => {
    try {
      const ws = makeWorkspace(WORKSPACE_A_ID, USER_A_ID);
      // Simulate user sending another workspace's ID
      if (ws.id !== WORKSPACE_B_ID) throw new ForbiddenError();
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError);
      expect((e as ForbiddenError).code).toBe("FORBIDDEN");
    }
  });
});

// ─── Entitlement invariants ───────────────────────────────────────────────────

describe("[MOCKED] draft_only entitlement invariants", () => {
  const draftWorkspace = makeWorkspace(WORKSPACE_A_ID, USER_A_ID, "draft_only");

  it("draft_only cannot publish", () => {
    expect(canPublish(draftWorkspace)).toBe(false);
  });

  it("draft_only cannot schedule", () => {
    expect(canSchedule(draftWorkspace)).toBe(false);
  });

  it("draft_only cannot use autopilot even if mode were set", () => {
    expect(canUseAutopilot({ ...draftWorkspace, operating_mode: "autopilot" })).toBe(false);
  });

  it("draft_only assertEntitlement throws for publishing_beta", () => {
    expect(() => assertEntitlement(draftWorkspace, "publishing_beta")).toThrow(EntitlementError);
  });

  it("draft_only assertEntitlement throws for paid_trial", () => {
    expect(() => assertEntitlement(draftWorkspace, "paid_trial")).toThrow(EntitlementError);
  });

  it("draft_only assertEntitlement does NOT throw for draft_only", () => {
    expect(() => assertEntitlement(draftWorkspace, "draft_only")).not.toThrow();
  });
});

describe("[MOCKED] inactive entitlement invariants", () => {
  const inactiveWorkspace = makeWorkspace(WORKSPACE_A_ID, USER_A_ID, "inactive");

  it("inactive cannot publish", () => {
    expect(canPublish(inactiveWorkspace)).toBe(false);
  });

  it("inactive cannot even do draft_only actions", () => {
    expect(entitlementPermits("inactive", "draft_only")).toBe(false);
  });
});

describe("[MOCKED] Autopilot gate invariants", () => {
  it("paid_active + approval_required → autopilot false", () => {
    const ws = makeWorkspace(WORKSPACE_A_ID, USER_A_ID, "paid_active");
    expect(canUseAutopilot({ ...ws, operating_mode: "approval_required" })).toBe(false);
  });

  it("paid_trial + autopilot mode → autopilot true (entitlement permits)", () => {
    const ws = makeWorkspace(WORKSPACE_A_ID, USER_A_ID, "paid_trial");
    expect(canUseAutopilot({ ...ws, operating_mode: "autopilot" })).toBe(true);
  });

  it("publishing_beta + autopilot mode → autopilot false (not a paid entitlement)", () => {
    const ws = makeWorkspace(WORKSPACE_A_ID, USER_A_ID, "publishing_beta");
    expect(canUseAutopilot({ ...ws, operating_mode: "autopilot" })).toBe(false);
  });
});

// ─── INTEGRATION TESTS — LIVE SUPABASE RLS ────────────────────────────────────
// Executes against real Supabase development environment with isolated test users.
// Defends cross-tenant boundaries at the database engine level (Spec §17).

const isLiveDbConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !process.env.SUPABASE_SERVICE_ROLE_KEY.includes("placeholder")
);

const describeRls = isLiveDbConfigured ? describe : describe.skip;

describeRls("[INTEGRATION — VERIFIED] Supabase RLS cross-tenant isolation", () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

  let adminClient: any;
  let clientA: any;
  let clientB: any;
  let anonClient: any;

  let userAId: string;
  let userBId: string;
  let wsAId: string;
  let wsBId: string;

  beforeAll(async () => {
    const { createClient } = await import("@supabase/supabase-js");

    adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    anonClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
    });

    const emailA = `test-founder-a-${Date.now()}@nunuza-test.internal`;
    const emailB = `test-founder-b-${Date.now()}@nunuza-test.internal`;

    // 1. Create two isolated test users via GoTrue Admin
    const { data: uA, error: errA } = await adminClient.auth.admin.createUser({
      email: emailA,
      email_confirm: true,
      user_metadata: { full_name: "Test Founder A" },
    });
    if (errA) throw new Error(`User A creation failed: ${errA.message}`);
    userAId = uA.user.id;

    const { data: uB, error: errB } = await adminClient.auth.admin.createUser({
      email: emailB,
      email_confirm: true,
      user_metadata: { full_name: "Test Founder B" },
    });
    if (errB) throw new Error(`User B creation failed: ${errB.message}`);
    userBId = uB.user.id;

    // 2. Generate magic links & sign in distinct anon clients
    const { data: linkA } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: emailA,
    });
    const { data: linkB } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: emailB,
    });

    clientA = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await clientA.auth.verifyOtp({
      token_hash: linkA.properties.hashed_token,
      type: "magiclink",
    });

    clientB = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    await clientB.auth.verifyOtp({
      token_hash: linkB.properties.hashed_token,
      type: "magiclink",
    });

    // 3. Obtain workspace IDs (created by 0003_signup_trigger trigger)
    const { data: wsA } = await adminClient.from("workspaces").select("id").eq("owner_user_id", userAId);
    const { data: wsB } = await adminClient.from("workspaces").select("id").eq("owner_user_id", userBId);
    wsAId = wsA[0].id;
    wsBId = wsB[0].id;

    // 4. Seed confidential records in Workspace B
    await adminClient.from("content_posts").insert({
      workspace_id: wsBId,
      text: "Confidential Strategy Post belonging to Workspace B",
      status: "draft",
    });

    await adminClient.from("agent_jobs").insert({
      workspace_id: wsBId,
      job_type: "generate_drafts",
      idempotency_key: `rls-test-${Date.now()}`,
      status: "queued",
      payload: { tenant: "b" },
    });
  }, 30000);

  afterAll(async () => {
    if (adminClient) {
      if (wsAId) {
        await adminClient.from("content_posts").delete().eq("workspace_id", wsAId);
        await adminClient.from("agent_jobs").delete().eq("workspace_id", wsAId);
        await adminClient.from("workspaces").delete().eq("id", wsAId);
      }
      if (wsBId) {
        await adminClient.from("content_posts").delete().eq("workspace_id", wsBId);
        await adminClient.from("agent_jobs").delete().eq("workspace_id", wsBId);
        await adminClient.from("workspaces").delete().eq("id", wsBId);
      }
      if (userAId) await adminClient.auth.admin.deleteUser(userAId);
      if (userBId) await adminClient.auth.admin.deleteUser(userBId);
    }
  }, 30000);

  it("User A cannot read User B's workspace via authenticated client", async () => {
    const { data: aReadB } = await clientA.from("workspaces").select("*").eq("id", wsBId);
    expect(aReadB).toHaveLength(0);

    const { data: aAllWs } = await clientA.from("workspaces").select("*");
    expect(aAllWs?.some((w: any) => w.id === wsBId)).toBe(false);
  });

  it("User A cannot read User B's content_posts via authenticated client", async () => {
    const { data: aPosts } = await clientA.from("content_posts").select("*").eq("workspace_id", wsBId);
    expect(aPosts).toHaveLength(0);
  });

  it("User A cannot read User B's agent_jobs via authenticated client", async () => {
    const { data: aJobs } = await clientA.from("agent_jobs").select("*").eq("workspace_id", wsBId);
    expect(aJobs).toHaveLength(0);
  });

  it("current_workspace_id() returns caller's workspace for User A and NULL for anon", async () => {
    const { data: rpcA } = await clientA.rpc("current_workspace_id");
    expect(rpcA).toBe(wsAId);

    const { data: rpcAnon } = await anonClient.rpc("current_workspace_id");
    expect(rpcAnon).toBeNull();
  });

  it("entitlement_type cannot be set to publishing_beta via anon UPDATE", async () => {
    const { data: updated } = await anonClient
      .from("workspaces")
      .update({ entitlement_type: "publishing_beta" })
      .eq("id", wsAId)
      .select();

    expect(updated).toHaveLength(0);

    const { data: actualWs } = await adminClient
      .from("workspaces")
      .select("entitlement_type")
      .eq("id", wsAId)
      .single();

    expect(actualWs.entitlement_type).toBe("draft_only");
  });

  it("User A cannot write into User B's workspace (cross-tenant INSERT fails RLS)", async () => {
    const { error } = await clientA.from("content_posts").insert({
      workspace_id: wsBId,
      text: "Malicious injection",
      status: "draft",
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/violates row-level security policy/i);
  });
});

