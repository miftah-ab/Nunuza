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
  canUseAutopilot,
  EntitlementError,
  ForbiddenError,
} from "@/lib/auth/workspace";
import { getPost } from "@/lib/db/posts";
import { logAuditEvent } from "@/lib/db/workspace";
import { publishPostToLinkedIn, LinkedInPublishError } from "@/lib/integrations/linkedin/client";
import { transitionJob, markJobRetryable, markJobTerminal } from "./state";
import { notifyWorkspaceTelegram } from "@/lib/integrations/telegram/service";
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

  if (post.status !== "approved") {
    throw new Error("Only approved posts can be scheduled. Submit the draft for review and approve it first.");
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
 * Safe Job Worker execution logic for publish_post.
 *
 * Fail-closed and duplicate-safe:
 *  - re-checks entitlement, pause state, post eligibility and posting caps immediately
 *    before publishing (never trusts what was true at scheduling time);
 *  - claims the post with compare-and-set (-> 'publishing') so two executors can
 *    never both publish it;
 *  - never fabricates a LinkedIn post ID: an unconfirmed publication becomes
 *    needs_reconciliation and is never retried automatically;
 *  - a job is only 'succeeded' after the post row was durably saved as 'published'.
 */

/** Compare-and-set a post's status. Returns true only if exactly this transition happened. */
async function casPostStatus(
  supabase: any,
  workspaceId: string,
  postId: string,
  fromStatuses: string[],
  patch: Record<string, unknown>
): Promise<boolean> {
  const { data, error } = await supabase
    .from("content_posts")
    .update(patch)
    .eq("id", postId)
    .eq("workspace_id", workspaceId)
    .in("status", fromStatuses)
    .select("id");
  if (error) {
    console.error(`[publisher] Post ${postId} status update failed: ${error.message}`);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

export async function executePublishJob(
  job: AgentJob,
  supabaseOverride?: any,
  options: { deferJobFinalization?: boolean } = {}
): Promise<JobExecutionResult> {
  const supabase = supabaseOverride || createServiceClient();

  const fail = (
    status: JobExecutionResult["status"],
    retryable: boolean,
    error: string
  ): JobExecutionResult => ({ jobId: job.id, success: false, status, retryable, error });

  // 1. Lease: queued jobs (inline Publish Now) are claimed here with compare-and-set.
  //    Jobs from the runner/queue arrive already 'running' with a lease and attempt counted.
  let attemptCount = job.attempt_count;
  if (job.status === "queued") {
    try {
      attemptCount = job.attempt_count + 1;
      const inlineLeaseUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await transitionJob(supabase, job.id, "queued", "running", {
        started_at: new Date().toISOString(),
        lease_until: inlineLeaseUntil,
        attempt_count: attemptCount,
      }, { attemptCount: job.attempt_count });
      job.status = "running";
      job.attempt_count = attemptCount;
      job.lease_until = inlineLeaseUntil;
    } catch {
      return fail(job.status, false, "Could not acquire job lease.");
    }
  }
  const jobGuard = () => ({
    attemptCount,
    leaseUntil: job.lease_until ?? undefined,
  });
  const transitionOutcome = async (
    to: "succeeded" | "needs_reconciliation" | "canceled",
    patch: Record<string, unknown>
  ) => {
    if (options.deferJobFinalization) return;
    await transitionJob(supabase, job.id, "running", to, patch, jobGuard());
  };
  const retryOutcome = async (message: string, errorCode: string) => {
    if (options.deferJobFinalization) return;
    await markJobRetryable(
      supabase,
      { id: job.id, attempt_count: attemptCount },
      message,
      errorCode,
      "running",
      jobGuard()
    );
  };
  const terminalOutcome = async (message: string, errorCode: string) => {
    if (options.deferJobFinalization) return;
    await markJobTerminal(supabase, job.id, message, errorCode, "running", jobGuard());
  };
  const persistJobPayloadPatch = async (patch: Record<string, unknown>) => {
    let query = supabase
      .from("agent_jobs")
      .update({
        payload: { ...(job.payload as Record<string, unknown>), ...patch },
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("status", "running")
      .eq("attempt_count", attemptCount);
    if (job.lease_until) query = query.eq("lease_until", job.lease_until);
    const { data, error } = await query.select("id");
    if (error || !Array.isArray(data) || data.length === 0) {
      throw new Error(
        `Could not persist LinkedIn publication evidence for job ${job.id}: ${error?.message ?? "lease ownership changed"}`
      );
    }
    job.payload = { ...(job.payload as Record<string, unknown>), ...patch };
  };
  const maxAttempts = job.max_attempts || 3;
  const payload = job.payload as unknown as PublishPostPayload & { autopilot?: boolean };

  const terminal = async (code: string, message: string) => {
    await terminalOutcome(message, code);
    return fail("failed_terminal", false, message);
  };

  // 2. Workspace entitlement (re-checked at execution time)
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("*")
    .eq("id", job.workspace_id)
    .single();

  if (!workspace || !canPublish(workspace)) {
    return terminal("ENTITLEMENT_INSUFFICIENT", "Workspace entitlement does not permit publishing.");
  }

  if (
    typeof payload?.postId !== "string" || !payload.postId.trim() ||
    (payload.workspaceId !== undefined && payload.workspaceId !== job.workspace_id) ||
    (payload.userId !== undefined && typeof payload.userId !== "string") ||
    (payload.targetProvider !== undefined && payload.targetProvider !== "linkedin") ||
    (payload.scheduledFor !== undefined &&
      (typeof payload.scheduledFor !== "string" || !Number.isFinite(Date.parse(payload.scheduledFor)))) ||
    (payload.autopilot !== undefined && typeof payload.autopilot !== "boolean")
  ) {
    return terminal("INVALID_PAYLOAD", "Publishing job payload is incomplete or inconsistent.");
  }
  if (payload.userId !== undefined && payload.userId !== workspace.owner_user_id) {
    return terminal("INVALID_PAYLOAD", "Publishing job owner does not match the workspace owner.");
  }

  if (payload.autopilot === true && (!canUseAutopilot(workspace) || workspace.state !== "active_autopilot")) {
    return terminal("AUTOPILOT_NOT_ENABLED", "Autopilot is no longer enabled for this workspace.");
  }

  // 3. Payload + post
  if (!payload?.postId) {
    return terminal("INVALID_PAYLOAD", "Missing postId in job payload.");
  }

  const { data: post } = await supabase
    .from("content_posts")
    .select("*")
    .eq("id", payload.postId)
    .eq("workspace_id", job.workspace_id)
    .single();

  if (!post) {
    return terminal("POST_NOT_FOUND", `Post ${payload.postId} not found.`);
  }

  // 4. Pause state: a paused agent never publishes. The post returns to 'approved'.
  if (workspace.paused_at) {
    await casPostStatus(supabase, job.workspace_id, post.id, ["scheduled"], { status: "approved", scheduled_at: null });
    await transitionOutcome("canceled", {
      finished_at: new Date().toISOString(),
      lease_until: null,
      last_error_code: "WORKSPACE_PAUSED",
      safe_error_message: "Agent is paused. The post was not published. Resume and reschedule it.",
    });
    return fail("canceled", false, "Agent is paused. The post was not published.");
  }

  // 5. Recover a publication already durably confirmed by a previous worker.
  // A lease may expire after LinkedIn succeeds but before the original worker
  // finalizes its job. Never cancel or republish a post already stored as live.
  if (post.status === "published" && typeof post.linkedin_post_id === "string" && post.linkedin_post_id.startsWith("urn:li:")) {
    await transitionOutcome("succeeded", {
      finished_at: new Date().toISOString(),
      lease_until: null,
      safe_error_message: null,
    });
    return {
      jobId: job.id,
      success: true,
      status: "succeeded",
      retryable: false,
      postUrn: post.linkedin_post_id,
    };
  }

  if (post.status === "published") {
    const message = "The post is marked published but has no trustworthy LinkedIn post ID. Reconciliation is required; Nunuza will not retry it.";
    await transitionOutcome("needs_reconciliation", {
      lease_until: null,
      last_error_code: "PUBLISHED_POST_ID_MISSING",
      safe_error_message: message,
    });
    return fail("needs_reconciliation", false, message);
  }

  // A previous worker may have sent the LinkedIn request before its lease
  // expired. Never cancel-and-retry a post already in the publishing state.
  if (post.status === "publishing" || post.status === "needs_reconciliation") {
    const message =
      "A previous LinkedIn publication attempt may still have reached LinkedIn. " +
      "Nunuza will not retry it automatically. Check LinkedIn and confirm the outcome.";
    if (post.status === "publishing") {
      await casPostStatus(supabase, job.workspace_id, post.id, ["publishing"], {
        status: "needs_reconciliation",
      });
    }
    await transitionOutcome("needs_reconciliation", {
      lease_until: null,
      last_error_code: "PUBLISH_ATTEMPT_ALREADY_IN_FLIGHT",
      safe_error_message: message,
    });
    return fail("needs_reconciliation", false, message);
  }

  // 6. Post eligibility + duplicate guard (compare-and-set to 'publishing')
  if (!["scheduled", "approved"].includes(post.status)) {
    const message =
      post.status === "published"
        ? "This post has already been published."
        : `Post is '${post.status}' and is not eligible for publishing.`;
    await transitionOutcome("canceled", {
      finished_at: new Date().toISOString(),
      lease_until: null,
      last_error_code: "POST_NOT_ELIGIBLE",
      safe_error_message: message,
    });
    return fail("canceled", false, message);
  }

  // 6. Atomically reserve the workspace's daily and rolling weekly publish slot.
  // The database serializes claims per workspace and marks this post publishing
  // before any external side effect is attempted.
  const priorStatus = post.status as "scheduled" | "approved";
  const { data: slotData, error: slotError } = await supabase.rpc("claim_workspace_publish_slot", {
    p_workspace_id: job.workspace_id,
    p_post_id: post.id,
  });

  if (slotError) {
    const message = "Could not safely reserve the workspace publishing slot: " + slotError.message;
    if (attemptCount < maxAttempts) {
      await retryOutcome(message, "PUBLISH_SLOT_CHECK_FAILED");
      return fail("failed_retryable", true, message);
    }
    return terminal("PUBLISH_SLOT_CHECK_FAILED", message);
  }

  const slot = Array.isArray(slotData) ? slotData[0] : slotData;
  if (!slot?.allowed) {
    const reason = String(slot?.reason ?? "POST_NOT_ELIGIBLE");
    const message = reason === "DAILY_CAP_REACHED"
      ? "Cap reached: Maximum 1 post per calendar day."
      : reason === "WEEKLY_CAP_REACHED"
        ? "Cap reached: Maximum 7 posts per rolling 7-day period."
        : "This post is no longer eligible for publishing.";
    await transitionOutcome("canceled", {
      finished_at: new Date().toISOString(),
      lease_until: null,
      last_error_code: reason,
      safe_error_message: message,
    });
    if (post.status === "scheduled") {
      await casPostStatus(supabase, job.workspace_id, post.id, ["scheduled"], {
        status: "approved",
        scheduled_at: null,
      });
    }
    return fail("canceled", false, message);
  }


  // 7. Publish via the official LinkedIn API
  let result: { linkedinPostId: string; publishedAt: string };
  try {
    result = await publishPostToLinkedIn({
      workspaceId: job.workspace_id,
      text: post.text,
      supabaseOverride: supabase,
    });
  } catch (publishErr: any) {
    const kind: string | undefined =
      publishErr instanceof LinkedInPublishError ? publishErr.kind : undefined;
    const errorMsg: string = publishErr?.message || "Failed to publish post to LinkedIn.";

    // Ambiguous (or unknown error type): the post may be live. Never retry, never fail the post.
    if (kind === "ambiguous" || kind === undefined) {
      const userMessage =
        "LinkedIn did not confirm this publication, so Nunuza cannot tell whether the post is live. " +
        "Check your LinkedIn profile, then confirm in Nunuza whether it was published. Nunuza will not retry automatically, to avoid a duplicate post.";
      await casPostStatus(supabase, job.workspace_id, post.id, ["publishing"], { status: "needs_reconciliation" });
      await transitionOutcome("needs_reconciliation", {
        lease_until: null,
        last_error_code: "PUBLICATION_UNCONFIRMED",
        safe_error_message: userMessage,
      });
      await logAuditEvent({
        workspaceId: job.workspace_id,
        actorType: "system",
        action: "publish_unconfirmed",
        resourceType: "content_post",
        resourceId: post.id,
        safeMetadata: { jobId: job.id, kind: kind ?? "unknown" },
      }).catch(() => {});
      notifyWorkspaceTelegram(job.workspace_id, {
        text:
          `⚠️ **Publication not confirmed**\n\n` +
          `Post: **${post.internal_title || "LinkedIn Post"}**\n` +
          `LinkedIn did not confirm whether this post went live. Please check your LinkedIn profile, ` +
          `then open Nunuza to confirm. It will not be retried automatically.`,
      }, supabase).catch(() => {});
      return fail("needs_reconciliation", false, userMessage);
    }

    // Definitively NOT published: put the post back, then retry or fail.
    if (kind === "rate_limited" && attemptCount < maxAttempts) {
      await casPostStatus(supabase, job.workspace_id, post.id, ["publishing"], { status: priorStatus });
      await retryOutcome(errorMsg, "LINKEDIN_RATE_LIMITED");
      return fail("failed_retryable", true, errorMsg);
    }

    await casPostStatus(supabase, job.workspace_id, post.id, ["publishing"], { status: "failed" });
    await terminalOutcome(
      errorMsg,
      kind === "auth" || kind === "not_connected" ? "LINKEDIN_INTEGRATION_ERROR" : "PUBLISH_FAILED"
    );
    notifyWorkspaceTelegram(job.workspace_id, {
      text:
        `⚠️ **Publishing Failed**\n\n` +
        `Post: **${post.internal_title || "LinkedIn Post"}**\n` +
        `Error: ${errorMsg}\n\n` +
        `Visit your Nunuza dashboard to review and reschedule.`,
    }, supabase).catch(() => {});
    return fail("failed_terminal", false, errorMsg);
  }

  // 8. LinkedIn confirmed a post ID. Save it durably BEFORE calling the job a success.
  let saved = false;
  for (let attempt = 0; attempt < 2 && !saved; attempt++) {
    saved = await casPostStatus(supabase, job.workspace_id, post.id, ["publishing"], {
      status: "published",
      published_at: result.publishedAt,
      linkedin_post_id: result.linkedinPostId,
    });
  }

  if (!saved) {
    const message =
      `LinkedIn confirmed the post (${result.linkedinPostId}) but Nunuza could not save that. ` +
      `Check the post in Nunuza and confirm it as published.`;
    await persistJobPayloadPatch({ linkedin_post_urn: result.linkedinPostId });
    await transitionOutcome("needs_reconciliation", {
      lease_until: null,
      last_error_code: "PERSIST_FAILED_AFTER_PUBLISH",
      safe_error_message: message,
    });
    await casPostStatus(supabase, job.workspace_id, post.id, ["publishing"], { status: "needs_reconciliation" });
    return fail("needs_reconciliation", false, message);
  }

  if (!options.deferJobFinalization) {
    try {
      await transitionOutcome("succeeded", {
        finished_at: new Date().toISOString(),
        lease_until: null,
        safe_error_message: null,
      });
    } catch (jobErr: any) {
      console.error(`[publisher] Post ${post.id} published but job ${job.id} could not be marked succeeded: ${jobErr?.message}`);
    }
  }

  await logAuditEvent({
    workspaceId: job.workspace_id,
    actorType: "system",
    action: "publish_post",
    resourceType: "content_post",
    resourceId: post.id,
    safeMetadata: { linkedinPostId: result.linkedinPostId, jobId: job.id },
  }).catch(() => {});

  notifyWorkspaceTelegram(job.workspace_id, {
    text:
      `🚀 **Post Published to LinkedIn!**\n\n` +
      `Your post is now live:\n` +
      `**${post.internal_title || "LinkedIn Post"}**\n\n` +
      `🔗 Post URN: \`${result.linkedinPostId}\``,
  }, supabase).catch(() => {});

  return {
    jobId: job.id,
    success: true,
    status: "succeeded",
    retryable: false,
    postUrn: result.linkedinPostId,
  };
}

export interface PublishNowResult {
  job: AgentJob;
  post: ContentPost;
  execution: JobExecutionResult;
}

/**
 * Publishes an approved post immediately.
 * Enqueues into agent_jobs and executes via executePublishJob.
 * Enforces:
 *   - Entitlement gate (draft_only workspaces strictly rejected)
 *   - Agent pause check
 *   - Approval check (post must be approved)
 *   - Daily cap (max 1 post/calendar day)
 *   - Weekly cap (max 7 posts/rolling 7 days)
 *   - Idempotency key per post / duplicate prevention
 */
export async function publishPostNow(
  claimedWorkspaceId: string,
  postId: string
): Promise<PublishNowResult> {
  const workspace = await requireWorkspace();

  if (workspace.id !== claimedWorkspaceId) {
    throw new ForbiddenError("You do not have access to this workspace.");
  }

  // 1. Strict entitlement gate (draft_only cannot publish, BED-02)
  if (!canPublish(workspace)) {
    throw new EntitlementError(
      "internal_beta or paid",
      workspace.entitlement_type
    );
  }

  // 2. Pause check
  if (workspace.paused_at) {
    throw new ForbiddenError("Agent is paused. Resume before publishing posts.");
  }

  // 3. Post verification: MUST be approved
  const post = await getPost(workspace.id, postId);
  if (!post) {
    throw new Error(`Post ${postId} not found.`);
  }

  if (post.status === "published") {
    throw new Error("This post has already been published to LinkedIn.");
  }

  if (post.status !== "approved") {
    throw new Error(`Only approved posts can be published immediately. Current status: '${post.status}'.`);
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

  const now = new Date();

  // 4. Rate-limit checks: 1 post/day cap & 7 posts/rolling 7 days (BED-02)
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const { data: sameDayScheduled, error: schedErr } = await supabase
    .from("content_posts")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("status", "scheduled")
    .neq("id", postId)
    .gte("scheduled_at", dayStart.toISOString())
    .lt("scheduled_at", dayEnd.toISOString());

  if (schedErr) throw new Error(`[publisher] Day cap check failed: ${schedErr.message}`);

  const { data: sameDayPublished, error: pubErr } = await supabase
    .from("content_posts")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("status", "published")
    .neq("id", postId)
    .gte("published_at", dayStart.toISOString())
    .lt("published_at", dayEnd.toISOString());

  if (pubErr) throw new Error(`[publisher] Day cap check failed: ${pubErr.message}`);

  const totalSameDay = (sameDayScheduled?.length || 0) + (sameDayPublished?.length || 0);
  if (totalSameDay >= 1) {
    throw new Error("Cap reached: Maximum 1 post per calendar day.");
  }

  // Rolling 7-day window check
  const windowStart = new Date(now.getTime() - 7 * 86400000);
  const { data: rollingScheduled, error: rollSchedErr } = await supabase
    .from("content_posts")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("status", "scheduled")
    .neq("id", postId)
    .gte("scheduled_at", windowStart.toISOString())
    .lte("scheduled_at", now.toISOString());

  if (rollSchedErr) throw new Error(`[publisher] Rolling cap check failed: ${rollSchedErr.message}`);

  const { data: rollingPublished, error: rollPubErr } = await supabase
    .from("content_posts")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("status", "published")
    .neq("id", postId)
    .gte("published_at", windowStart.toISOString())
    .lte("published_at", now.toISOString());

  if (rollPubErr) throw new Error(`[publisher] Rolling cap check failed: ${rollPubErr.message}`);

  const totalRolling = (rollingScheduled?.length || 0) + (rollingPublished?.length || 0);
  if (totalRolling >= 7) {
    throw new Error("Cap reached: Maximum 7 posts per rolling 7-day period.");
  }

  // 5. Stable idempotency key & duplicate prevention
  const idempotencyKey = `publish-${workspace.id}-${postId}`;

  const { data: existingJob } = await supabase
    .from("agent_jobs")
    .select()
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existingJob) {
    if (existingJob.status === "running") {
      throw new Error("This post is currently being published. Please wait.");
    }
    if (existingJob.status === "succeeded") {
      throw new Error("This post has already been published to LinkedIn.");
    }
  }

  // 6. Enqueue job into agent_jobs
  const payload: PublishPostPayload = {
    postId,
    workspaceId: workspace.id,
    userId: workspace.owner_user_id,
    targetProvider: "linkedin",
    scheduledFor: now.toISOString(),
  };

  let job: AgentJob;

  if (existingJob) {
    const { data: updatedJob, error: updateErr } = await supabase
      .from("agent_jobs")
      .update({
        status: "queued",
        payload: payload as unknown as Record<string, unknown>,
        scheduled_for: now.toISOString(),
        attempt_count: 0,
        safe_error_message: null,
      })
      .eq("id", existingJob.id)
      .select()
      .single();

    if (updateErr) throw new Error(`[publisher] Failed to update publishing job: ${updateErr.message}`);
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
        scheduled_for: now.toISOString(),
        attempt_count: 0,
        max_attempts: 3,
        safe_error_message: null,
      })
      .select()
      .single();

    if (jobErr) throw new Error(`[publisher] Failed to enqueue publishing job: ${jobErr.message}`);
    job = newJob as AgentJob;
  }

  // 7. Audit logging
  await logAuditEvent({
    workspaceId: workspace.id,
    actorType: "user",
    actorId: workspace.owner_user_id,
    action: "publish_post_now",
    resourceType: "content_post",
    resourceId: postId,
    safeMetadata: {
      jobId: job.id,
      idempotencyKey,
    },
  });

  // 8. Execute immediately via existing publishing architecture
  const execution = await executePublishJob(job, supabase);

  const updatedPost = (await getPost(workspace.id, postId)) || post;

  if (!execution.success) {
    throw new Error(execution.error || "LinkedIn publishing failed.");
  }

  return {
    job,
    post: updatedPost,
    execution,
  };
}
