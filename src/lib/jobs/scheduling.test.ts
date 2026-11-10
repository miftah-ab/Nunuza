/**
 * Scheduling & Job Processing Unit Tests (Mocked).
 *
 * Verifies:
 * - draft_only workspaces are strictly prohibited from scheduling (BED-02)
 * - Agent pause state prevents scheduling
 * - Daily cap (max 1 post/day) and weekly cap (max 7 posts/week)
 * - Cancel scheduled post returns post to approved status
 * - executePublishJob fails closed safely without faking LinkedIn posts (BED-03)
 * - publishPostNow safety gates: entitlement, pause, approval, caps, idempotency
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  schedulePost,
  cancelScheduledPost,
  executePublishJob,
  publishPostNow,
} from "./scheduling";
import { EntitlementError, ForbiddenError, requireWorkspace } from "@/lib/auth/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { publishPostToLinkedIn, LinkedInPublishError } from "@/lib/integrations/linkedin/client";
import { MockSupabase, makeJob } from "@/test/mock-supabase";
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
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/integrations/telegram/service", () => ({
  notifyWorkspaceTelegram: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/integrations/linkedin/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/integrations/linkedin/client")>();
  return { ...actual, publishPostToLinkedIn: vi.fn() };
});

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
    entitlement_type: "internal_beta",
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
                    data: [{ id: "existing-scheduled-post" }],
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

    const futureDate = new Date(Date.now() + 3600000).toISOString();

    await expect(
      schedulePost("ws-beta", "post-101", futureDate)
    ).rejects.toThrow("Cap reached: Maximum 1 scheduled post per calendar day.");
  });

  it("cancelScheduledPost returns post to approved status", async () => {
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

  describe("executePublishJob (confirmed publication only)", () => {
    beforeEach(() => {
      vi.mocked(publishPostToLinkedIn).mockReset();
    });

    const seed = (postStatus: ContentPost["status"] = "scheduled", jobOverrides: Record<string, any> = {}) => {
      const db = new MockSupabase();
      db.tables.workspaces.push({ ...betaWorkspace });
      db.posts.push({ ...sampleApprovedPost, status: postStatus });
      const job = makeJob({
        id: "job-101",
        workspace_id: "ws-beta",
        status: "running",
        attempt_count: 1,
        payload: { postId: "post-101" },
        ...jobOverrides,
      }) as AgentJob;
      db.jobs.push(job);
      return { db, job };
    };

    it("fails closed and terminal when LinkedIn is not connected, with no fabricated post ID", async () => {
      const { db, job } = seed();
      vi.mocked(publishPostToLinkedIn).mockRejectedValueOnce(
        new LinkedInPublishError("not_connected", "LINKEDIN_NOT_CONNECTED: LinkedIn is not connected for this workspace.")
      );

      const outcome = await executePublishJob(job, db);

      expect(outcome.success).toBe(false);
      expect(outcome.status).toBe("failed_terminal");
      expect(outcome.error).toContain("LinkedIn is not connected");
      expect(outcome.postUrn).toBeUndefined();
      expect(db.jobs[0].status).toBe("failed_terminal");
      expect(db.posts[0].status).toBe("failed");
      expect(db.posts[0].linkedin_post_id).toBeNull();
    });

    it("on confirmed publication saves the real post ID, then marks the job succeeded", async () => {
      const { db, job } = seed();
      vi.mocked(publishPostToLinkedIn).mockResolvedValueOnce({
        linkedinPostId: "urn:li:share:7000000000000000001",
        publishedAt: new Date().toISOString(),
      });

      const outcome = await executePublishJob(job, db);

      expect(outcome.success).toBe(true);
      expect(outcome.postUrn).toBe("urn:li:share:7000000000000000001");
      expect(db.posts[0].status).toBe("published");
      expect(db.posts[0].linkedin_post_id).toBe("urn:li:share:7000000000000000001");
      expect(db.jobs[0].status).toBe("succeeded");
    });

    it("moves an AMBIGUOUS publication to needs_reconciliation and never retries it", async () => {
      const { db, job } = seed();
      vi.mocked(publishPostToLinkedIn).mockRejectedValueOnce(
        new LinkedInPublishError("ambiguous", "LINKEDIN_AMBIGUOUS_PUBLICATION: no post ID returned")
      );

      const outcome = await executePublishJob(job, db);

      expect(outcome.success).toBe(false);
      expect(outcome.status).toBe("needs_reconciliation");
      expect(outcome.retryable).toBe(false);
      expect(db.jobs[0].status).toBe("needs_reconciliation");
      expect(db.jobs[0].last_error_code).toBe("PUBLICATION_UNCONFIRMED");
      expect(db.posts[0].status).toBe("needs_reconciliation");
      expect(db.posts[0].linkedin_post_id).toBeNull();
      expect(vi.mocked(publishPostToLinkedIn)).toHaveBeenCalledTimes(1);
      expect(outcome.error).toContain("will not retry automatically");
    });

    it("treats an unknown error type as ambiguous (the safe default), not as a retryable failure", async () => {
      const { db, job } = seed();
      vi.mocked(publishPostToLinkedIn).mockRejectedValueOnce(new Error("something unexpected"));

      const outcome = await executePublishJob(job, db);
      expect(outcome.status).toBe("needs_reconciliation");
      expect(db.jobs[0].status).toBe("needs_reconciliation");
    });

    it("retries a rate-limited publish, putting the post back where it was", async () => {
      const { db, job } = seed();
      vi.mocked(publishPostToLinkedIn).mockRejectedValueOnce(
        new LinkedInPublishError("rate_limited", "LINKEDIN_RATE_LIMITED (429)")
      );

      const outcome = await executePublishJob(job, db);

      expect(outcome.status).toBe("failed_retryable");
      expect(db.jobs[0].status).toBe("failed_retryable");
      expect(db.jobs[0].lease_until).toBeNull();
      expect(db.posts[0].status).toBe("scheduled");
    });

    it("fails terminally when rate limited on the last attempt", async () => {
      const { db, job } = seed("scheduled", { attempt_count: 3, max_attempts: 3 });
      vi.mocked(publishPostToLinkedIn).mockRejectedValueOnce(
        new LinkedInPublishError("rate_limited", "LINKEDIN_RATE_LIMITED (429)")
      );

      const outcome = await executePublishJob(job, db);
      expect(outcome.status).toBe("failed_terminal");
      expect(db.posts[0].status).toBe("failed");
    });

    it("never reports success if LinkedIn confirmed but the post could not be saved", async () => {
      const { db, job } = seed();
      db.opts.failPostUpdateWhen = (patch) => patch.status === "published";
      vi.mocked(publishPostToLinkedIn).mockResolvedValueOnce({
        linkedinPostId: "urn:li:share:7000000000000000002",
        publishedAt: new Date().toISOString(),
      });

      const outcome = await executePublishJob(job, db);

      expect(outcome.success).toBe(false);
      expect(outcome.status).toBe("needs_reconciliation");
      expect(db.jobs[0].status).toBe("needs_reconciliation");
      expect(db.jobs[0].last_error_code).toBe("PERSIST_FAILED_AFTER_PUBLISH");
      expect((db.jobs[0].payload as any).linkedin_post_urn).toBe("urn:li:share:7000000000000000002");
      expect(db.posts[0].status).toBe("needs_reconciliation");
    });

    it("does not publish when the agent is paused, and returns the post to approved", async () => {
      const { db, job } = seed();
      db.tables.workspaces[0].paused_at = new Date().toISOString();

      const outcome = await executePublishJob(job, db);

      expect(outcome.status).toBe("canceled");
      expect(db.jobs[0].status).toBe("canceled");
      expect(db.posts[0].status).toBe("approved");
      expect(vi.mocked(publishPostToLinkedIn)).not.toHaveBeenCalled();
    });

    it("re-checks entitlement at execution time", async () => {
      const { db, job } = seed();
      db.tables.workspaces[0].entitlement_type = "draft_only";

      const outcome = await executePublishJob(job, db);

      expect(outcome.status).toBe("failed_terminal");
      expect(vi.mocked(publishPostToLinkedIn)).not.toHaveBeenCalled();
    });

    it("re-checks the daily cap (1/day) immediately before publishing", async () => {
      const { db, job } = seed();
      db.posts.push({
        id: "already-today",
        workspace_id: "ws-beta",
        status: "published",
        published_at: new Date().toISOString(),
      });

      const outcome = await executePublishJob(job, db);

      expect(outcome.status).toBe("canceled");
      expect(outcome.error).toContain("1 post per calendar day");
      expect(vi.mocked(publishPostToLinkedIn)).not.toHaveBeenCalled();
    });

    it("re-checks the rolling 7-day cap (7/week)", async () => {
      const { db, job } = seed();
      for (let i = 1; i <= 7; i++) {
        db.posts.push({
          id: `wk-${i}`,
          workspace_id: "ws-beta",
          status: "published",
          published_at: new Date(Date.now() - (1.1 + 0.8 * (i - 1)) * 86400000).toISOString(),
        });
      }

      const outcome = await executePublishJob(job, db);

      expect(outcome.status).toBe("canceled");
      expect(outcome.error).toContain("7 posts per rolling 7-day");
      expect(vi.mocked(publishPostToLinkedIn)).not.toHaveBeenCalled();
    });

    it("recovers a post already confirmed by a previous worker without publishing again", async () => {
      const { db, job } = seed("published");
      db.posts[0].linkedin_post_id = "urn:li:share:7000000000000000099";

      const outcome = await executePublishJob(job, db);

      expect(outcome.success).toBe(true);
      expect(outcome.status).toBe("succeeded");
      expect(outcome.postUrn).toBe("urn:li:share:7000000000000000099");
      expect(db.jobs[0].status).toBe("succeeded");
      expect(vi.mocked(publishPostToLinkedIn)).not.toHaveBeenCalled();
    });

    it("never publishes a post that is already published", async () => {
      const { db, job } = seed("published");

      const outcome = await executePublishJob(job, db);

      expect(outcome.status).toBe("canceled");
      expect(vi.mocked(publishPostToLinkedIn)).not.toHaveBeenCalled();
    });

    it("only one of two concurrent executions of the same queued job may publish", async () => {
      const { db } = seed("scheduled");
      const queued = makeJob({
        id: "job-101",
        workspace_id: "ws-beta",
        status: "queued",
        attempt_count: 0,
        payload: { postId: "post-101" },
      });
      db.jobs[0] = queued;
      vi.mocked(publishPostToLinkedIn).mockResolvedValue({
        linkedinPostId: "urn:li:share:7000000000000000003",
        publishedAt: new Date().toISOString(),
      });

      const [a, b] = await Promise.all([
        executePublishJob({ ...queued }, db),
        executePublishJob({ ...queued }, db),
      ]);

      expect(vi.mocked(publishPostToLinkedIn)).toHaveBeenCalledTimes(1);
      expect([a.success, b.success].filter(Boolean)).toHaveLength(1);
    });
  });

  // ─── publishPostNow Safety Gates ────────────────────────────────────────────

  describe("publishPostNow (Immediate Publishing Feature)", () => {
    it("rejects unauthorized workspace access", async () => {
      vi.mocked(requireWorkspace).mockResolvedValue(betaWorkspace);
      await expect(
        publishPostNow("wrong-workspace-id", sampleApprovedPost.id)
      ).rejects.toThrow(ForbiddenError);
    });

    it("strictly prohibits draft_only workspaces from publishing now", async () => {
      vi.mocked(requireWorkspace).mockResolvedValue(draftOnlyWorkspace);
      await expect(
        publishPostNow(draftOnlyWorkspace.id, sampleApprovedPost.id)
      ).rejects.toThrow(EntitlementError);
    });

    it("blocks publishing when workspace agent is paused", async () => {
      const pausedWorkspace: Workspace = {
        ...betaWorkspace,
        paused_at: new Date().toISOString(),
      };
      vi.mocked(requireWorkspace).mockResolvedValue(pausedWorkspace);

      await expect(
        publishPostNow(pausedWorkspace.id, sampleApprovedPost.id)
      ).rejects.toThrow("Agent is paused. Resume before publishing posts.");
    });

    it("rejects unapproved posts (draft)", async () => {
      const { getPost } = await import("@/lib/db/posts");
      vi.mocked(requireWorkspace).mockResolvedValue(betaWorkspace);
      vi.mocked(getPost).mockResolvedValue({ ...sampleApprovedPost, status: "draft" });

      await expect(
        publishPostNow(betaWorkspace.id, sampleApprovedPost.id)
      ).rejects.toThrow("Only approved posts can be published immediately.");
    });

    it("enforces daily posting limit (max 1 post per day)", async () => {
      const { getPost } = await import("@/lib/db/posts");
      vi.mocked(requireWorkspace).mockResolvedValue(betaWorkspace);
      vi.mocked(getPost).mockResolvedValue(sampleApprovedPost);

      // cap query returns 1 existing post today
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                neq: vi.fn().mockReturnValue({
                  gte: vi.fn().mockReturnValue({
                    lt: vi.fn().mockResolvedValue({
                      data: [{ id: "existing-today" }],
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      };
      vi.mocked(createServiceClient).mockReturnValue(mockSupabase as any);

      await expect(
        publishPostNow(betaWorkspace.id, sampleApprovedPost.id)
      ).rejects.toThrow("Cap reached: Maximum 1 post per calendar day.");
    });

    it("prevents duplicate publishing when job is already running", async () => {
      const { getPost } = await import("@/lib/db/posts");
      vi.mocked(requireWorkspace).mockResolvedValue(betaWorkspace);
      vi.mocked(getPost).mockResolvedValue(sampleApprovedPost);

      const emptyCap = vi.fn().mockResolvedValue({ data: [], error: null });
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "content_posts") {
            // All 4 cap queries (day: .lt, rolling: .lte) return empty to pass through
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    neq: vi.fn().mockReturnValue({
                      gte: vi.fn().mockReturnValue({
                        lt: emptyCap,
                        lte: emptyCap,
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "agent_jobs") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: "existing-job", status: "running" },
                    error: null,
                  }),
                }),
              }),
            };
          }
          return { select: vi.fn() };
        }),
      };
      vi.mocked(createServiceClient).mockReturnValue(mockSupabase as any);

      await expect(
        publishPostNow(betaWorkspace.id, sampleApprovedPost.id)
      ).rejects.toThrow("This post is currently being published. Please wait.");
    });

    it("prevents duplicate publishing when job already succeeded", async () => {
      const { getPost } = await import("@/lib/db/posts");
      vi.mocked(requireWorkspace).mockResolvedValue(betaWorkspace);
      vi.mocked(getPost).mockResolvedValue(sampleApprovedPost);

      const emptyCap = vi.fn().mockResolvedValue({ data: [], error: null });
      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === "content_posts") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    neq: vi.fn().mockReturnValue({
                      gte: vi.fn().mockReturnValue({
                        lt: emptyCap,
                        lte: emptyCap,
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "agent_jobs") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: "existing-job", status: "succeeded" },
                    error: null,
                  }),
                }),
              }),
            };
          }
          return { select: vi.fn() };
        }),
      };
      vi.mocked(createServiceClient).mockReturnValue(mockSupabase as any);

      await expect(
        publishPostNow(betaWorkspace.id, sampleApprovedPost.id)
      ).rejects.toThrow("This post has already been published to LinkedIn.");
    });
  });
});
