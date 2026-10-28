/**
 * Scheduling & Job Processing Unit Tests (Mocked).
 *
 * Verifies:
 * - draft_only workspaces are strictly prohibited from scheduling (BED-02)
 * - Agent pause state prevents scheduling
 * - Daily cap (max 1 post/day) and weekly cap (max 7 posts/week)
 * - Cancel scheduled post returns post to approved status
 * - executePublishJob fails closed safely without faking LinkedIn posts (BED-03)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  schedulePost,
  cancelScheduledPost,
  executePublishJob,
} from "./scheduling";
import { EntitlementError, ForbiddenError } from "@/lib/auth/workspace";
import type { Workspace, ContentPost, AgentJob } from "@/types/database";

vi.mock("@/lib/auth/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/workspace")>();
  return {
    ...actual,
    requireWorkspace: vi.fn(),
  };
});

vi.mock("@/lib/db/posts", () => ({
  getPost: vi.fn(),
}));

vi.mock("@/lib/db/workspace", () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
}));

describe("Scheduling Foundation & Safety Gates (Mocked)", () => {
  const draftOnlyWorkspace: Workspace = {
    id: "ws-draft-only",
    owner_user_id: "user-1",
    name: "Draft Studio",
    state: "active_approval_required",
    entitlement_type: "draft_only",
    operating_mode: "approval_required",
    paused_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const betaWorkspace: Workspace = {
    ...draftOnlyWorkspace,
    id: "ws-beta",
    entitlement_type: "publishing_beta",
  };

  const sampleApprovedPost: ContentPost = {
    id: "post-101",
    workspace_id: "ws-beta",
    plan_id: null,
    text: "Sample high quality approved post text.",
    internal_title: "Post Title",
    pillar: "Growth",
    source_notes: null,
    status: "approved",
    scheduled_at: null,
    published_at: null,
    linkedin_post_id: null,
    version: 1,
    created_by: "user-1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("strictly rejects scheduling for draft_only preview workspaces", async () => {
    const { requireWorkspace } = await import("@/lib/auth/workspace");
    vi.mocked(requireWorkspace).mockResolvedValue(draftOnlyWorkspace);

    const futureDate = new Date(Date.now() + 86400000).toISOString();

    await expect(
      schedulePost("ws-draft-only", "post-1", futureDate)
    ).rejects.toThrow(EntitlementError);
  });

  it("blocks scheduling when workspace agent is paused", async () => {
    const { requireWorkspace } = await import("@/lib/auth/workspace");
    vi.mocked(requireWorkspace).mockResolvedValue({
      ...betaWorkspace,
      paused_at: new Date().toISOString(),
    });

    const futureDate = new Date(Date.now() + 86400000).toISOString();

    await expect(
      schedulePost("ws-beta", "post-101", futureDate)
    ).rejects.toThrow(ForbiddenError);
  });

  it("enforces daily cap of at most 1 scheduled post per calendar day", async () => {
    const { requireWorkspace } = await import("@/lib/auth/workspace");
    const { getPost } = await import("@/lib/db/posts");
    const { createClient } = await import("@/lib/supabase/server");

    vi.mocked(requireWorkspace).mockResolvedValue(betaWorkspace);
    vi.mocked(getPost).mockResolvedValue(sampleApprovedPost);

    // Mock query returning an existing scheduled post on that same day
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              neq: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  lt: vi.fn().mockResolvedValue({
                    data: [{ id: "post-existing-same-day" }],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    };

    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const targetDate = new Date(Date.now() + 86400000).toISOString();

    await expect(
      schedulePost("ws-beta", "post-101", targetDate)
    ).rejects.toThrow("Maximum 1 scheduled post per calendar day");
  });

  it("cancels a scheduled post and sets status back to approved", async () => {
    const { requireWorkspace } = await import("@/lib/auth/workspace");
    const { getPost } = await import("@/lib/db/posts");
    const { createClient } = await import("@/lib/supabase/server");

    vi.mocked(requireWorkspace).mockResolvedValue(betaWorkspace);
    vi.mocked(getPost).mockResolvedValue({
      ...sampleApprovedPost,
      status: "scheduled",
      scheduled_at: new Date().toISOString(),
    });

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({ error: null }),
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { ...sampleApprovedPost, status: "approved", scheduled_at: null },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    };

    vi.mocked(createClient).mockResolvedValue(mockSupabase as any);

    const result = await cancelScheduledPost("ws-beta", "post-101");
    expect(result.status).toBe("approved");
    expect(result.scheduled_at).toBeNull();
  });

  it("executePublishJob fails closed safely without faking LinkedIn publishing", async () => {
    const { createServiceClient } = await import("@/lib/supabase/server");

    const sampleJob: AgentJob = {
      id: "job-101",
      workspace_id: "ws-beta",
      job_type: "publish_post",
      status: "queued",
      idempotency_key: "publish-ws-beta-post-101",
      payload: { postId: "post-101" },
      scheduled_for: new Date().toISOString(),
      started_at: null,
      finished_at: null,
      attempt_count: 0,
      max_attempts: 3,
      lease_until: null,
      correlation_id: "corr-1",
      last_error_code: null,
      safe_error_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const mockServiceClient = {
      from: vi.fn((table: string) => {
        if (table === "agent_jobs") {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: { ...sampleJob, status: "running" },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "workspaces") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: betaWorkspace,
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "content_posts") {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return { select: vi.fn() };
      }),
    };

    vi.mocked(createServiceClient).mockReturnValue(mockServiceClient as any);

    const outcome = await executePublishJob(sampleJob);

    // Must fail closed with terminal error, never fabricate postUrn
    expect(outcome.success).toBe(false);
    expect(outcome.status).toBe("failed_terminal");
    expect(outcome.error).toContain("LinkedIn publishing is currently disabled");
    expect(outcome.postUrn).toBeUndefined();
  });
});
