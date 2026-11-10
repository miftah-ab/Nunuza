/**
 * Durable Job Runner & State Machine.
 *
 * 1. Claims due jobs atomically in the database (claim_due_agent_jobs RPC,
 *    FOR UPDATE SKIP LOCKED): two workers can never claim the same job.
 * 2. Dispatches to a registered handler per job_type.
 * 3. Applies explicit, checked state transitions (see ./state.ts). A failed
 *    database write is never ignored and never reported as success.
 * 4. Exponential backoff for retryable errors, up to max_attempts.
 * 5. Records attempt history in agent_job_attempts.
 * 6. Reconciles jobs whose worker died: publish jobs that may already have
 *    reached LinkedIn go to needs_reconciliation, never to a blind retry.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { executePublishJob } from "./scheduling";
import {
  JobTransitionError,
  markJobRetryable,
  markJobTerminal,
  transitionJob,
} from "./state";
import type { AgentJob } from "@/types/database";
import type { JobExecutionResult } from "./types";

export interface ClaimJobsOptions {
  limit?: number;
  leaseMinutes?: number;
  jobTypes?: string[];
}

export type JobHandler = (job: AgentJob, supabase: any) => Promise<JobExecutionResult>;

/** Registered handlers. Each job_type that may be queued must be present here. */
const handlers: Record<string, JobHandler> = {
  publish_post: (job, supabase) => executePublishJob(job, supabase),
};

export function registerJobHandler(jobType: string, handler: JobHandler): void {
  handlers[jobType] = handler;
}

/**
 * Atomically claims due jobs. Returns only jobs this call actually claimed.
 * Throws if the database call fails (never silently returns an empty list).
 */
export async function claimDueJobs(
  options: ClaimJobsOptions = {},
  supabaseOverride?: any
): Promise<AgentJob[]> {
  const supabase = supabaseOverride || createServiceClient();
  const limit = options.limit ?? 10;
  const leaseSeconds = Math.round((options.leaseMinutes ?? 5) * 60);

  const { data, error } = await supabase.rpc("claim_due_agent_jobs", {
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
    p_job_types: options.jobTypes ?? null,
  });

  if (error) {
    throw new Error(`[runner] claim_due_agent_jobs failed: ${error.message}`);
  }

  return (data ?? []) as AgentJob[];
}

/**
 * Dispatches a claimed job to its handler and records the outcome.
 */
export async function processJob(
  job: AgentJob,
  supabaseOverride?: any
): Promise<JobExecutionResult> {
  const supabase = supabaseOverride || createServiceClient();
  const startTime = new Date();

  // Fence: only run a job that is still 'running'. A queue redelivery of a job
  // that already finished, was canceled or was reconciled must not run again.
  const { data: current, error: readErr } = await supabase
    .from("agent_jobs")
    .select("id, status, attempt_count, max_attempts")
    .eq("id", job.id)
    .single();

  if (readErr || !current) {
    throw new Error(`[runner] Could not re-read job ${job.id}: ${readErr?.message ?? "not found"}`);
  }
  if (current.status !== "running") {
    return {
      jobId: job.id,
      success: false,
      status: current.status,
      retryable: false,
      error: `Job is '${current.status}', not 'running'; skipped.`,
    };
  }

  const attemptCount: number = current.attempt_count ?? job.attempt_count;
  const maxAttempts: number = current.max_attempts ?? job.max_attempts;
  const liveJob = { ...job, attempt_count: attemptCount, max_attempts: maxAttempts } as AgentJob;

  let result: JobExecutionResult;
  try {
    const handler = handlers[liveJob.job_type];
    if (!handler) {
      result = {
        jobId: liveJob.id,
        success: false,
        status: "failed_terminal",
        retryable: false,
        error: `Unrecognized job type: ${liveJob.job_type}`,
      };
    } else {
      result = await handler(liveJob, supabase);
    }
  } catch (err: any) {
    result = {
      jobId: liveJob.id,
      success: false,
      status: "failed_retryable",
      retryable: true,
      error: err?.message || "Unexpected runner error",
    };
  }

  const finishedTime = new Date();

  // Attempt history (audit). A failure here is logged loudly but does not change job state.
  const { error: attemptErr } = await supabase.from("agent_job_attempts").insert({
    workspace_id: liveJob.workspace_id,
    job_id: liveJob.id,
    attempt_number: attemptCount,
    started_at: startTime.toISOString(),
    finished_at: finishedTime.toISOString(),
    outcome: result.status,
    safe_error_code: result.error
      ? result.status === "failed_terminal"
        ? "TERMINAL_ERROR"
        : result.status === "needs_reconciliation"
          ? "NEEDS_RECONCILIATION"
          : "RETRYABLE_ERROR"
      : null,
  });
  if (attemptErr) {
    // Attempt history is part of the durable execution record. Do not finalize
    // a job (especially a successful side effect) when its outcome could not
    // be durably recorded. Leave the lease intact for stale-job reconciliation.
    throw new JobTransitionError(
      `[runner] Failed to record attempt for job ${liveJob.id}: ${attemptErr.message}`
    );
  }

  // Finalize only if the handler left the job in 'running'.
  // Handlers that persist their own terminal state (publish_post) are left alone.
  const { data: after, error: afterErr } = await supabase
    .from("agent_jobs")
    .select("status")
    .eq("id", liveJob.id)
    .single();

  if (afterErr || !after) {
    throw new JobTransitionError(
      `[runner] Could not confirm final state of job ${liveJob.id}: ${afterErr?.message ?? "not found"}`
    );
  }

  if (after.status === "running") {
    if (result.success) {
      await transitionJob(supabase, liveJob.id, "running", "succeeded", {
        finished_at: finishedTime.toISOString(),
        lease_until: null,
        safe_error_message: null,
      });
    } else if (result.status === "needs_reconciliation") {
      await transitionJob(supabase, liveJob.id, "running", "needs_reconciliation", {
        lease_until: null,
        last_error_code: "NEEDS_RECONCILIATION",
        safe_error_message: result.error ?? "Outcome could not be confirmed.",
      });
    } else if (result.retryable && attemptCount < maxAttempts) {
      await markJobRetryable(
        supabase,
        { id: liveJob.id, attempt_count: attemptCount },
        result.error ?? "Retryable error.",
        "RETRYABLE_ERROR"
      );
    } else {
      await markJobTerminal(
        supabase,
        liveJob.id,
        result.error ?? "Job failed.",
        "TERMINAL_ERROR"
      );
    }
  } else if (result.success && after.status !== "succeeded") {
    // Handler reported success but the persisted state disagrees: never report success.
    throw new JobTransitionError(
      `[runner] Job ${liveJob.id} reported success but is persisted as '${after.status}'.`
    );
  }

  return result;
}

/**
 * Reconciles jobs whose worker died or timed out while 'running' (lease expired).
 *
 * publish_post jobs are special: if the post was already moved to 'publishing' the
 * LinkedIn request may have been sent, so the job and post go to needs_reconciliation
 * and are NEVER retried automatically (that could publish twice). Only jobs whose
 * post never reached 'publishing' are safe to retry.
 */
export async function reconcileStaleJobs(supabaseOverride?: any): Promise<number> {
  const supabase = supabaseOverride || createServiceClient();
  const nowIso = new Date().toISOString();

  const { data: staleJobs, error } = await supabase
    .from("agent_jobs")
    .select("*")
    .eq("status", "running")
    .lt("lease_until", nowIso);

  if (error) {
    throw new Error(`[runner] Stale job lookup failed: ${error.message}`);
  }
  if (!staleJobs || staleJobs.length === 0) return 0;

  let reconciledCount = 0;

  for (const job of staleJobs as AgentJob[]) {
    try {
      if (job.job_type === "publish_post") {
        const postId = (job.payload as any)?.postId as string | undefined;
        let postStatus: string | null = null;
        if (postId) {
          const { data: post, error: postErr } = await supabase
            .from("content_posts")
            .select("status")
            .eq("id", postId)
            .single();
          if (postErr || !post) {
            throw new Error(`Could not read post ${postId}: ${postErr?.message ?? "not found"}`);
          }
          postStatus = post.status;
        }

        if (postStatus === "publishing" || postStatus === "needs_reconciliation") {
          // Persist the post's ambiguous state before closing its job. If this
          // write fails, keep the job recoverable instead of leaving the post
          // and job in contradictory states.
          if (postId && postStatus === "publishing") {
            const { data: updatedPost, error: postUpdErr } = await supabase
              .from("content_posts")
              .update({ status: "needs_reconciliation" })
              .eq("id", postId)
              .eq("status", "publishing")
              .select("id");
            if (postUpdErr) {
              throw new Error(
                `Could not mark post ${postId} needs_reconciliation: ${postUpdErr.message}`
              );
            }
            if (!Array.isArray(updatedPost) || updatedPost.length === 0) {
              const { data: latestPost, error: latestErr } = await supabase
                .from("content_posts")
                .select("status")
                .eq("id", postId)
                .single();
              if (latestErr || latestPost?.status !== "needs_reconciliation") {
                throw new Error(
                  `Post ${postId} changed before reconciliation could be persisted.`
                );
              }
            }
          }
          await transitionJob(supabase, job.id, "running", "needs_reconciliation", {
            lease_until: null,
            last_error_code: "WORKER_DIED_DURING_PUBLISH",
            safe_error_message:
              "The worker stopped while publishing. The post may already be live on LinkedIn. Check your LinkedIn profile and confirm the outcome in Nunuza.",
          });
          reconciledCount++;
          continue;
        }
      }

      if (job.attempt_count >= job.max_attempts) {
        await markJobTerminal(
          supabase,
          job.id,
          "Job lease expired and max attempts reached.",
          "LEASE_EXPIRED_MAX_ATTEMPTS"
        );
      } else {
        await transitionJob(supabase, job.id, "running", "failed_retryable", {
          scheduled_for: nowIso,
          lease_until: null,
          last_error_code: "LEASE_EXPIRED",
          safe_error_message: "Worker lease expired. Re-enqueued for retry.",
        });
      }
      reconciledCount++;
    } catch (err: any) {
      // One bad job must not stop reconciliation of the others, but it must be visible.
      console.error(`[runner] Failed to reconcile stale job ${job.id}: ${err?.message}`);
    }
  }

  return reconciledCount;
}
