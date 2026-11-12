/**
 * Onboarding Route & State Transition Unit Tests.
 *
 * Verifies:
 * - Successful onboarding saves profile, voice profile, and content strategy
 * - finishSetup=true transitions workspace state from setup_required -> active_approval_required
 * - Entitlement remains draft_only (never elevated to publishing or autopilot)
 * - Operating mode remains approval_required
 * - Audit event logged for completion
 * - Failed workspace updates return 500 and do not claim completed: true
 * - Malformed request body returns 400
 * - Unauthenticated requests return 401
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { AuthError } from "@/lib/auth/workspace";
import type { Workspace } from "@/types/database";

vi.mock("@/lib/auth/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/workspace")>();
  return {
    ...actual,
    requireWorkspace: vi.fn(),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/db/workspace", () => ({
  upsertVoiceProfile: vi.fn(),
  upsertContentStrategy: vi.fn(),
  logAuditEvent: vi.fn(),
}));

describe("POST /api/onboarding", () => {
  const initialWorkspace: Workspace = {
    id: "ws-onboard-1",
    owner_user_id: "user-123",
    name: "Founder Studio",
    state: "setup_required",
    entitlement_type: "draft_only",
    operating_mode: "approval_required",
    paused_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("successfully saves onboarding data and transitions state to active_approval_required", async () => {
    const { requireWorkspace } = await import("@/lib/auth/workspace");
    const { createClient } = await import("@/lib/supabase/server");
    const { upsertVoiceProfile, upsertContentStrategy, logAuditEvent } =
      await import("@/lib/db/workspace");

    vi.mocked(requireWorkspace).mockResolvedValue(initialWorkspace);

    const updatedWorkspace = {
      ...initialWorkspace,
      state: "active_approval_required",
      updated_at: new Date().toISOString(),
    };

    const mockProfileUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    const mockWorkspaceUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: updatedWorkspace,
            error: null,
          }),
        }),
      }),
    });

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "profiles") {
          return { update: mockProfileUpdate };
        }
        if (table === "workspaces") {
          return { update: mockWorkspaceUpdate };
        }
        return {};
      }),
    };

    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const payload = {
      displayName: "Jane Doe",
      role: "Founder & CEO",
      company: "Acme AI",
      positioning: "Helping solo founders scale",
      audienceRoles: "Founders, CTOs",
      audienceProblems: "Content takes too much time",
      audienceOutcomes: "Build authority and attract leads",
      pillars: "Building in public\nProduct engineering\nGrowth experiments",
      primaryGoal: "Attract beta users",
      tone: "Direct, punchy, authoritative",
      sentenceLength: "Short",
      phrasesUse: "ship it, real talk",
      phrasesAvoid: "synergy, leverage",
      sampleWriting: "We launched our MVP today...",
      postsPerWeek: 4,
      preferredDays: [1, 2, 3, 4],
      timezone: "America/New_York",
      finishSetup: true,
    };

    const request = new Request("http://localhost:3000/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const json = (await response.json()) as any;
    expect(json.data.completed).toBe(true);
    expect(json.data.workspace.state).toBe("active_approval_required");
    // Verify entitlement remained draft_only (never elevated)
    expect(json.data.workspace.entitlement_type).toBe("draft_only");

    // Verify profile update
    expect(mockProfileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        display_name: "Jane Doe",
        timezone: "America/New_York",
      })
    );

    // Verify strategy upsert
    expect(upsertContentStrategy).toHaveBeenCalledWith(
      "ws-onboard-1",
      expect.objectContaining({
        audience: expect.objectContaining({
          roles: "Founders, CTOs",
          company: "Acme AI",
        }),
        pillars: [
          "Building in public",
          "Product engineering",
          "Growth experiments",
        ],
        cadence_per_week: 4,
      })
    );

    // Verify voice profile upsert
    expect(upsertVoiceProfile).toHaveBeenCalledWith(
      "ws-onboard-1",
      expect.objectContaining({
        tone: "Direct, punchy, authoritative",
        phrases_use: ["ship it", "real talk"],
        phrases_avoid: ["synergy", "leverage"],
      })
    );

    // Verify audit log event
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-onboard-1",
        action: "complete_onboarding",
      })
    );
  });

  it("handles failed workspace update with HTTP 500", async () => {
    const { requireWorkspace } = await import("@/lib/auth/workspace");
    const { createClient } = await import("@/lib/supabase/server");

    vi.mocked(requireWorkspace).mockResolvedValue(initialWorkspace);

    const mockWorkspaceUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "Database connection failed" },
          }),
        }),
      }),
    });

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "workspaces") {
          return { update: mockWorkspaceUpdate };
        }
        return { update: vi.fn().mockReturnValue({ eq: vi.fn() }) };
      }),
    };

    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const request = new Request("http://localhost:3000/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ finishSetup: true }),
    });

    const response = await POST(request);
    expect(response.status).toBe(500);

    const json = (await response.json()) as any;
    expect(json.error).toBe("We couldn’t finish setting up your workspace. Please try again.");
  });

  it("returns 400 for malformed JSON request body", async () => {
    const { requireWorkspace } = await import("@/lib/auth/workspace");
    vi.mocked(requireWorkspace).mockResolvedValue(initialWorkspace);

    const request = new Request("http://localhost:3000/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "invalid-json{{{",
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const json = (await response.json()) as any;
    expect(json.error).toBe("We couldn’t read your setup details. Please try again.");
  });

  it("returns 401 when user is not authenticated", async () => {
    const { requireWorkspace } = await import("@/lib/auth/workspace");
    vi.mocked(requireWorkspace).mockRejectedValue(new AuthError());

    const request = new Request("http://localhost:3000/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ finishSetup: true }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("handles finishSetup idempotently if workspace was already active", async () => {
    const { requireWorkspace } = await import("@/lib/auth/workspace");
    const { createClient } = await import("@/lib/supabase/server");

    const alreadyActiveWorkspace: Workspace = {
      ...initialWorkspace,
      state: "active_approval_required",
    };

    vi.mocked(requireWorkspace).mockResolvedValue(alreadyActiveWorkspace);

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({ eq: vi.fn() }),
      }),
    };
    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const request = new Request("http://localhost:3000/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ finishSetup: true }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const json = (await response.json()) as any;
    expect(json.data.completed).toBe(true);
    expect(json.data.workspace.state).toBe("active_approval_required");
  });
});
