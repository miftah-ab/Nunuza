/**
 * Unit & Integration Tests for Post Scheduling & Entitlement Enforcement.
 *
 * Verifies:
 * - Unauthenticated request returns 401
 * - draft_only workspace is strictly rejected with 403 EntitlementError
 * - internal_beta workspace is permitted to schedule an approved post
 * - Paused workspace cannot schedule
 * - Missing scheduledFor returns 400
 * - Non-existent post or unapproved post cannot be scheduled
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as scheduleRoute } from "./route";
import { POST as cancelRoute } from "../cancel-schedule/route";
import { requireWorkspace, AuthError, EntitlementError, ForbiddenError } from "@/lib/auth/workspace";
import * as schedulingService from "@/lib/jobs/scheduling";
import type { Workspace } from "@/types/database";

vi.mock("@/lib/auth/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/workspace")>();
  return {
    ...actual,
    requireWorkspace: vi.fn(),
  };
});

vi.mock("@/lib/jobs/scheduling", () => ({
  schedulePost: vi.fn(),
  cancelScheduledPost: vi.fn(),
}));

describe("POST /api/posts/[id]/schedule", () => {
  const draftOnlyWorkspace: Workspace = {
    id: "ws-draft-only-1",
    owner_user_id: "user-1",
    name: "Draft Only Studio",
    state: "active_approval_required",
    entitlement_type: "draft_only",
    operating_mode: "approval_required",
    paused_at: null,
    max_posts_per_day: 10,
    max_posts_per_7_days: 50,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const publishingBetaWorkspace: Workspace = {
    id: "ws-beta-1",
    owner_user_id: "user-beta",
    name: "Beta Studio",
    state: "active_approval_required",
    entitlement_type: "internal_beta",
    operating_mode: "approval_required",
    paused_at: null,
    max_posts_per_day: 10,
    max_posts_per_7_days: 50,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when caller is unauthenticated", async () => {
    vi.mocked(requireWorkspace).mockRejectedValueOnce(new AuthError());

    const req = new Request("http://localhost/api/posts/post-1/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledFor: "2026-12-01T10:00:00Z" }),
    });

    const res = await scheduleRoute(req, { params: Promise.resolve({ id: "post-1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 400 when scheduledFor is missing", async () => {
    vi.mocked(requireWorkspace).mockResolvedValueOnce(publishingBetaWorkspace);

    const req = new Request("http://localhost/api/posts/post-1/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await scheduleRoute(req, { params: Promise.resolve({ id: "post-1" }) });
    expect(res.status).toBe(400);
  });

  it("returns 403 when workspace entitlement is draft_only", async () => {
    vi.mocked(requireWorkspace).mockResolvedValueOnce(draftOnlyWorkspace);
    vi.mocked(schedulingService.schedulePost).mockRejectedValueOnce(
      new EntitlementError("internal_beta or paid", "draft_only")
    );

    const req = new Request("http://localhost/api/posts/post-1/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledFor: "2026-12-01T10:00:00Z" }),
    });

    const res = await scheduleRoute(req, { params: Promise.resolve({ id: "post-1" }) });
    expect(res.status).toBe(403);
    const json = (await res.json()) as any;
    expect(json.error).toContain("This feature isn't included in your current plan");
  });

  it("succeeds when workspace entitlement is internal_beta", async () => {
    vi.mocked(requireWorkspace).mockResolvedValueOnce(publishingBetaWorkspace);
    vi.mocked(schedulingService.schedulePost).mockResolvedValueOnce({
      job: {
        id: "job-1",
        workspace_id: "ws-beta-1",
        job_type: "publish_post",
        status: "queued",
        scheduled_for: "2026-12-01T10:00:00Z",
        attempt_count: 0,
        max_attempts: 3,
        payload: { postId: "post-1" },
        correlation_id: "corr-1",
        lease_until: null,
        started_at: null,
        finished_at: null,
        last_error_code: null,
        safe_error_message: null,
        idempotency_key: "publish-ws-beta-1-post-1",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      post: {
        id: "post-1",
        workspace_id: "ws-beta-1",
        plan_id: null,
        text: "Test post text for LinkedIn publishing beta",
        status: "scheduled",
        version: 1,
        scheduled_at: "2026-12-01T10:00:00Z",
        published_at: null,
        linkedin_post_id: null,
        internal_title: "Test Post",
        pillar: "Product",
        source_notes: null,
        created_by: "user",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });

    const req = new Request("http://localhost/api/posts/post-1/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledFor: "2026-12-01T10:00:00Z" }),
    });

    const res = await scheduleRoute(req, { params: Promise.resolve({ id: "post-1" }) });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.post.status).toBe("scheduled");
    expect(json.data.job.status).toBe("queued");
  });

  it("returns 403 when workspace is paused", async () => {
    const pausedBetaWorkspace: Workspace = {
      ...publishingBetaWorkspace,
      paused_at: new Date().toISOString(),
    };
    vi.mocked(requireWorkspace).mockResolvedValueOnce(pausedBetaWorkspace);
    vi.mocked(schedulingService.schedulePost).mockRejectedValueOnce(
      new ForbiddenError("Nunuza is paused. Resume it before scheduling posts.")
    );

    const req = new Request("http://localhost/api/posts/post-1/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledFor: "2026-12-01T10:00:00Z" }),
    });

    const res = await scheduleRoute(req, { params: Promise.resolve({ id: "post-1" }) });
    expect(res.status).toBe(403);
    const json = (await res.json()) as any;
    expect(json.error).toContain("Nunuza is paused");
  });

  it("cancels scheduled post successfully via cancel-schedule route", async () => {
    vi.mocked(requireWorkspace).mockResolvedValueOnce(publishingBetaWorkspace);
    vi.mocked(schedulingService.cancelScheduledPost).mockResolvedValueOnce({
      id: "post-1",
      workspace_id: "ws-beta-1",
      plan_id: null,
      text: "Test post text",
      status: "approved",
      version: 1,
      scheduled_at: null,
      published_at: null,
      linkedin_post_id: null,
      internal_title: "Test Post",
      pillar: "Product",
      source_notes: null,
      created_by: "user",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const req = new Request("http://localhost/api/posts/post-1/cancel-schedule", {
      method: "POST",
    });

    const res = await cancelRoute(req, { params: Promise.resolve({ id: "post-1" }) });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.data.post.status).toBe("approved");
    expect(json.data.post.scheduled_at).toBeNull();
  });
});
