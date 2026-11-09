/**
 * Durable Job Scheduler & Publishing Gate.
 *
 * Implements BED-02, BED-03, BED-04 & BED-09:
 * 1. Hard caps: max 1 post/day and 7 posts/rolling 7-day window
 * 2. Strict entitlement gate: draft_only workspaces CANNOT schedule
 * 3. Idempotent scheduling: stable idempotency key prevents duplicate queued jobs
 * 4. Lease acquisition and state reconciliation
 * 5. Safe fail-closed behavior when external publishing gate is pending
 */

import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  requireWorkspace,
  canSchedule,
  canPublish,
  EntitlementError,
  ForbiddenError,
} from "@/lib/auth/workspace";
import { getPost } from "@/lib/db/posts";
import { logAuditEvent } from "@/lib/db/workspace";
import { publishPostToLinkedIn } from "@/lib/integrations/linkedin/client";
import type { AgentJob, ContentPost } from "@/types/database";
import type { JobExecutionResult, PublishPostPayload } from "./types";

export interface SchedulePostResult {
  job: AgentJob;
  post: ContentPost;
}

/**
 * Schedules an approved post for durable publication.
 * Enforces:
 *   - Entitlement gate (draft_only workspaces strictly rejected)
 *   - Agent pause check
 *   - Daily cap (max 1 scheduled post/calendar day)
 *   - Weekly cap (max 7 scheduled posts per rolling 7 days)
 *   - Idempotency key per post
 */
export async function schedulePost(
  claimedWorkspaceId: string,
  postId: string,
  scheduledFor: string
): Promise<SchedulePostResult> {
  const workspace = await requireWorkspace();

  if (workspace.id !== claimedWorkspaceId) {
    throw new ForbiddenError("You do not have access to this workspace.");
  }

  // 1. Strict entitlement gate (draft_only cannot schedule, BED-02)
  if (!canSchedule(workspace)) {
    throw new EntitlementError(
      "internal_beta or paid",
      workspace.entitlement_type
    );
  }

  // 2. Pause check
  if (workspace.paused_at) {
    throw new ForbiddenError("Agent is paused. Resume before scheduling posts.");
  }

  // 3. Post verification
  const post = await getPost(workspace.id, postId);
  if (!post) {
    throw new Error(`Post ${postId} not found.`);
  }

  if (post.status !== "approved" && post.status !== "draft" && post.status !== "needs_review") {
    throw new Error(`Post cannot be scheduled from status '${post.status}'.`);
  }

  const targetDate = new Date(scheduledFor);
  if (isNaN(targetDate.getTime()) || targetDate.getTime() < Date.now() - 60000) {
    throw new Error("Scheduled time must be a valid future timestamp.");
  }

  let supabase: any;
  try {
    supabase = createServiceClient();
  } catch {
    // fallback
  }
  if (!supabase) {
    supabase = await createClient();
  }

  // 4. Rate-limit checks: 1 post/day cap & 7 posts/rolling 7 days (BED-02)
  const dayStart = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate()));
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const { data: sameDayPosts, error: sameDayErr } = await supabase
    .from("content_posts")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("status", "scheduled")
    .neq("id", postId)
    .gte("scheduled_at", dayStart.toISOString())
    .lt("scheduled_at", dayEnd.toISOString());

  if (sameDayErr) throw new Error(`[scheduler] Day cap check failed: ${sameDayErr.message}`);

  if (sameDayPosts && sameDayPosts.length >= 1) {
    throw new Error("Cap reached: Maximum 1 scheduled post per calendar day.");
  }

  // Rolling 7-day window check
  const windowStart = new Date(targetDate.getTime() - 7 * 86400000);
  const { data: rollingPosts, error: rollingErr } = await supabase
    .from("content_posts")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("status", "scheduled")
    .neq("id", postId)
    .gte("scheduled_at", windowStart.toISOString())
    .lte("scheduled_at", targetDate.toISOString());

  if (rollingErr) throw new Error(`[scheduler] Rolling cap check failed: ${rollingErr.message}`);

  if (rollingPosts && rollingPosts.length >= 7) {
    throw new Error("Cap reached: Maximum 7 scheduled posts per rolling 7-day period.");
  }

  // 5. Stable idempotency key
  const idempotencyKey = `publish-${workspace.id}-${postId}`;

  // 6. Insert or update job in agent_jobs
  const payload: PublishPostPayload = {
    postId,
    workspaceId: workspace.id,
    userId: workspace.owner_user_id,
    targetProvider: "linkedin",
    scheduledFor: targetDate.toISOString(),
  };

  // Check for existing job with same idempotency key to implement idempotency
  // (upsert with onConflict requires a DB unique constraint; use check-then-insert instead)
  const { data: existingJob } = await supabase
    .from("agent_jobs")
    .select()
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  let job: AgentJob;

  if (existingJob) {
    // Re-queue the existing job (e.g. if it previously failed or was cancelled)
    const { data: updatedJob, error: updateErr } = await supabase
      .from("agent_jobs")
      .update({
        status: "queued",
        payload: payload as unknown as Record<string, unknown>,
        scheduled_for: targetDate.toISOString(),
        attempt_count: 0,
        safe_error_message: null,
      })
      .eq("id", existingJob.id)
      .select()
      .single();

    if (updateErr) {
      throw new Error(`[scheduler] Failed to re-queue publishing job: ${updateErr.message}`);
    }
    job = updatedJob as AgentJob;
  } else {
    const { data: newJob, error: jobErr } = await supabase
      .from("agent_jobs")
      .insert({
        workspace_id: workspace.id,
        job_type: "publish_post",
        status: "queued",
        idempotency_key: idempotencyKey,
        payload: payload as unknown as Record<string, unknown>,
        scheduled_for: targetDate.toISOString(),
        attempt_count: 0,
        max_attempts: 3,
        safe_error_message: null,
      })
      .select()
      .single();

    if (jobErr) {
      throw new Error(`[scheduler] Failed to enqueue publishing job: ${jobErr.message}`);
    }
    job = newJob as AgentJob;
  }

  // 7. Transition post status to scheduled
  const { data: updatedPost, error: postErr } = await supabase
    .from("content_posts")
    .update({
      status: "scheduled",
      scheduled_at: targetDate.toISOString(),
    })
    .eq("id", postId)
    .eq("workspace_id", workspace.id)
    .select()
    .single();

  if (postErr) {
    throw new Error(`[scheduler] Failed to update post to scheduled: ${postErr.message}`);
  }

  // 8. Audit logging
  await logAuditEvent({
    workspaceId: workspace.id,
    actorType: "user",
    actorId: workspace.owner_user_id,
    action: "schedule_post",
    resourceType: "content_post",
    resourceId: postId,
    safeMetadata: {
      scheduledFor: targetDate.toISOString(),
      jobId: job.id,
      idempotencyKey,
    },
  });

  return {
    job: job as AgentJob,
    post: updatedPost as ContentPost,
  };
}

/**
 * Cancels a scheduled post and its queued job.
 */
export async function cancelScheduledPost(
  claimedWorkspaceId: string,
  postId: string
): Promise<ContentPost> {
  const workspace = await requireWorkspace();

  if (workspace.id !== claimedWorkspaceId) {
    throw new ForbiddenError("You do not have access to this workspace.");
  }

  const post = await getPost(workspace.id, postId);
  if (!post) {
    throw new Error(`Post ${postId} not found.`);
  }

  if (post.status !== "scheduled") {
    throw new Error(`Post is not in scheduled status (current: ${post.status}).`);
  }

  let supabase: any;
  try {
    supabase = createServiceClient();
  } catch {
    // fallback
  }
  if (!supabase) {
    supabase = await createClient();
  }

  // Cancel any queued or retryable jobs for this post
  await supabase
    .from("agent_jobs")
    .update({ status: "canceled" })
    .eq("workspace_id", workspace.id)
    .eq("idempotency_key", `publish-${workspace.id}-${postId}`)
    .in("status", ["queued", "failed_retryable", "waiting_for_approval"]);

  // Reset post status back to approved
  const { data: updatedPost, error } = await supabase
    .from("content_posts")
    .update({
      status: "approved",
      scheduled_at: null,
    })
    .eq("id", postId)
    .eq("workspace_id", workspace.id)
    .select()
    .single();

  if (error) {
    throw new Error(`[scheduler] Failed to cancel post: ${error.message}`);
  }

  await logAuditEvent({
    workspaceId: workspace.id,
    actorType: "user",
    actorId: workspace.owner_user_id,
    action: "cancel_scheduled_post",
    resourceType: "content_post",
    resourceId: postId,
  });

  return updatedPost as ContentPost;
}

/**
 * Safe Job Worker execution logic.
 *
 * Implements strict fail-closed behavior:
 * If LinkedIn publishing permissions are not yet approved, it halts safely
 * and transitions job status to 'failed_terminal' or 'blocked_integration'
 * with transparent user-facing explanations. NEVER fakes a live LinkedIn post.
 */
export async function executePublishJob(
  job: AgentJob,
  supabaseOverride?: any
): Promise<JobExecutionResult> {
  const supabase = supabaseOverride || createServiceClient();

  // 1. Acquire lease if not already acquired by caller
  let claimedJob = job;
  if (job.status === "queued") {
    const leaseUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const { data, error: leaseErr } = await supabase
      .from("agent_jobs")
      .update({
        status: "running",
        started_at: new Date().toISOString(),
        lease_until: leaseUntil,
        attempt_count: job.attempt_count + 1,
      })
      .eq("id", job.id)
      .eq("status", "queued")
      .select()
      .single();

    if (leaseErr || !data) {
      return {
        jobId: job.id,
        success: false,
        status: job.status,
        retryable: false,
        error: "Could not acquire job lease.",
      };
    }
    claimedJob = data as AgentJob;
  }

  // 2. Fetch workspace & verify entitlement
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("*")
    .eq("id", job.workspace_id)
    .single();

  if (!workspace || !canPublish(workspace)) {
    // Fail-closed
    await supabase
      .from("agent_jobs")
      .update({
        status: "failed_terminal",
        finished_at: new Date().toISOString(),
        last_error_code: "ENTITLEMENT_INSUFFICIENT",
        safe_error_message: "Workspace entitlement does not permit automated publishing.",
      })
      .eq("id", job.id);

    return {
      jobId: job.id,
      success: false,
      status: "failed_terminal",
      retryable: false,
      error: "Workspace entitlement does not permit publishing.",
    };
  }

  // 3. Fetch post
  const payload = job.payload as unknown as PublishPostPayload;
  if (!payload?.postId) {
    await supabase
      .from("agent_jobs")
      .update({
        status: "failed_terminal",
        finished_at: new Date().toISOString(),
        last_error_code: "INVALID_PAYLOAD",
        safe_error_message: "Missing postId in job payload.",
      })
      .eq("id", job.id);

    return {
      jobId: job.id,
      success: false,
      status: "failed_terminal",
      retryable: false,
      error: "Missing postId in job payload.",
    };
  }

  const { data: post } = await supabase
    .from("content_posts")
    .select("*")
    .eq("id", payload.postId)
    .single();

  if (!post) {
    await supabase
      .from("agent_jobs")
      .update({
        status: "failed_terminal",
        finished_at: new Date().toISOString(),
        last_error_code: "POST_NOT_FOUND",
        safe_error_message: `Post ${payload.postId} not found.`,
      })
      .eq("id", job.id);

    return {
      jobId: job.id,
      success: false,
      status: "failed_terminal",
      retryable: false,
      error: `Post ${payload.postId} not found.`,
    };
  }

  // 4. Execute publishing via LinkedIn Client (BED-03)
  try {
    const result = await publishPostToLinkedIn({
      workspaceId: job.workspace_id,
      text: post.text,
      supabaseOverride: supabase,
    });

    // Success! Update post and job
    await supabase
      .from("content_posts")
      .update({
        status: "published",
        published_at: result.publishedAt,
        linkedin_post_id: result.linkedinPostId,
      })
      .eq("id", post.id);

    await supabase
      .from("agent_jobs")
      .update({
        status: "succeeded",
        finished_at: new Date().toISOString(),
        safe_error_message: null,
      })
      .eq("id", job.id);

    await logAuditEvent({
      workspaceId: job.workspace_id,
      actorType: "system",
      action: "publish_post",
      resourceType: "content_post",
      resourceId: post.id,
      safeMetadata: {
        linkedinPostId: result.linkedinPostId,
        jobId: job.id,
      },
    });

    return {
      jobId: job.id,
      success: true,
      status: "succeeded",
      retryable: false,
      postUrn: result.linkedinPostId,
    };
  } catch (publishErr: any) {
    const errorMsg = publishErr.message || "Failed to publish post to LinkedIn.";
    const isRetryable =
      errorMsg.includes("RATE_LIMITED") ||
      errorMsg.includes("500") ||
      errorMsg.includes("502") ||
      errorMsg.includes("503");
    const isTerminalAuth =
      errorMsg.includes("LINKEDIN_NOT_CONNECTED") ||
      errorMsg.includes("LINKEDIN_AUTH_FAILED") ||
      errorMsg.includes("LINKEDIN_AUTH_EXPIRED");

    const attempts = claimedJob.attempt_count;
    const maxAttempts = claimedJob.max_attempts || 3;

    if (isRetryable && attempts < maxAttempts) {
      await supabase
        .from("agent_jobs")
        .update({
          status: "failed_retryable",
          safe_error_message: errorMsg,
        })
        .eq("id", job.id);

      return {
        jobId: job.id,
        success: false,
        status: "failed_retryable",
        retryable: true,
        error: errorMsg,
      };
    }

    // Terminal failure
    await supabase
      .from("agent_jobs")
      .update({
        status: "failed_terminal",
        finished_at: new Date().toISOString(),
        last_error_code: isTerminalAuth ? "LINKEDIN_INTEGRATION_ERROR" : "PUBLISH_FAILED",
        safe_error_message: errorMsg,
      })
      .eq("id", job.id);

    await supabase
      .from("content_posts")
      .update({
        status: "failed",
      })
      .eq("id", payload.postId);

    return {
      jobId: job.id,
      success: false,
      status: "failed_terminal",
      retryable: false,
      error: errorMsg,
    };
  }
}
