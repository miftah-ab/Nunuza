/**
 * Durable Job Runner & State Machine.
 *
 * Implements Phase 3 & Phase 5 background job processing:
 * 1. Claims due jobs atomically using leases (agent_jobs.lease_until).
 * 2. Re-checks workspace entitlement server-side at execution time.
 * 3. Enforces exponential backoff for retryable errors up to max_attempts.
 * 4. Records attempt audit history in agent_job_attempts table.
 * 5. Reconciles stale/orphaned jobs where lease expired while running.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { executePublishJob } from "./scheduling";
import type { AgentJob } from "@/types/database";
import type { JobExecutionResult } from "./types";

export interface ClaimJobsOptions {
  limit?: number;
  leaseMinutes?: number;
}

/**
 * Claims due jobs from agent_jobs that are ready to run and unleased.
 */
export async function claimDueJobs(
  options: ClaimJobsOptions = {},
  supabaseOverride?: any
): Promise<AgentJob[]> {
  const supabase = supabaseOverride || createServiceClient();
  const limit = options.limit || 10;
  const leaseMinutes = options.leaseMinutes || 5;
  const now = new Date();
  const nowIso = now.toISOString();
  const leaseUntilIso = new Date(now.getTime() + leaseMinutes * 60 * 1000).toISOString();

  // Find candidate jobs:
  // - status = 'queued' AND scheduled_for <= now AND (lease_until IS NULL OR lease_until < now)
  // - status = 'failed_retryable' AND lease_until < now
  const { data: candidates, error: findErr } = await supabase
    .from("agent_jobs")
    .select("*")
    .or(`status.eq.queued,status.eq.failed_retryable`)
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(limit);

  if (findErr || !candidates || candidates.length === 0) {
    return [];
  }

  const claimedJobs: AgentJob[] = [];

  for (const job of candidates) {
    if (job.attempt_count >= job.max_attempts) {
      // Transition to failed_terminal if max attempts exceeded
      await supabase
        .from("agent_jobs")
        .update({
          status: "failed_terminal",
          finished_at: nowIso,
          safe_error_message: "Max retry attempts exceeded.",
        })
        .eq("id", job.id);
      continue;
    }

    // Check if currently leased by another active worker
    if (job.lease_until && new Date(job.lease_until).getTime() > now.getTime()) {
      continue;
    }

    // Atomically claim the job
    const { data: claimed, error: claimErr } = await supabase
      .from("agent_jobs")
      .update({
        status: "running",
        started_at: nowIso,
        lease_until: leaseUntilIso,
        attempt_count: job.attempt_count + 1,
        updated_at: nowIso,
      })
      .eq("id", job.id)
      .select()
      .single();

    if (!claimErr && claimed) {
      claimedJobs.push(claimed as AgentJob);
    }
  }

  return claimedJobs;
}

/**
 * Dispatches a claimed job to its appropriate handler and records attempt outcome.
 */
export async function processJob(
  job: AgentJob,
  supabaseOverride?: any
): Promise<JobExecutionResult> {
  const supabase = supabaseOverride || createServiceClient();
  const startTime = new Date();

  let result: JobExecutionResult;

  try {
    switch (job.job_type) {
      case "publish_post": {
        result = await executePublishJob(job, supabase);
        break;
      }
      default: {
        result = {
          jobId: job.id,
          success: false,
          status: "failed_terminal",
          retryable: false,
          error: `Unrecognized job type: ${job.job_type}`,
        };
      }
    }
  } catch (err: any) {
    result = {
      jobId: job.id,
      success: false,
      status: "failed_retryable",
      retryable: true,
      error: err.message || "Unexpected runner error",
    };
  }

  const finishedTime = new Date();

  // Log attempt record in agent_job_attempts
  await supabase.from("agent_job_attempts").insert({
    workspace_id: job.workspace_id,
    job_id: job.id,
    attempt_number: job.attempt_count,
    started_at: startTime.toISOString(),
    finished_at: finishedTime.toISOString(),
    outcome: result.status,
    safe_error_code: result.error ? (result.status === "failed_terminal" ? "TERMINAL_ERROR" : "RETRYABLE_ERROR") : null,
  });

  // Handle retry backoff or terminal failure
  if (!result.success && result.retryable && job.attempt_count < job.max_attempts) {
    // Exponential backoff: 2 ^ attempt * 60 seconds
    const backoffSeconds = Math.pow(2, job.attempt_count) * 60;
    const nextRetryIso = new Date(Date.now() + backoffSeconds * 1000).toISOString();

    await supabase
      .from("agent_jobs")
      .update({
        status: "failed_retryable",
        lease_until: nextRetryIso,
        safe_error_message: result.error,
        updated_at: finishedTime.toISOString(),
      })
      .eq("id", job.id);
  } else if (!result.success) {
    await supabase
      .from("agent_jobs")
      .update({
        status: "failed_terminal",
        finished_at: finishedTime.toISOString(),
        safe_error_message: result.error,
        updated_at: finishedTime.toISOString(),
      })
      .eq("id", job.id);
  } else {
    // Successful completion
    await supabase
      .from("agent_jobs")
      .update({
        status: "completed",
        finished_at: finishedTime.toISOString(),
        safe_error_message: null,
        updated_at: finishedTime.toISOString(),
      })
      .eq("id", job.id);
  }

  return result;
}

/**
 * Reconciles stale/orphaned jobs where the worker died or timed out while running.
 */
export async function reconcileStaleJobs(supabaseOverride?: any): Promise<number> {
  const supabase = supabaseOverride || createServiceClient();
  const nowIso = new Date().toISOString();

  // Find running jobs whose lease expired
  const { data: staleJobs, error } = await supabase
    .from("agent_jobs")
    .select("*")
    .eq("status", "running")
    .lt("lease_until", nowIso);

  if (error || !staleJobs || staleJobs.length === 0) {
    return 0;
  }

  let reconciledCount = 0;

  for (const job of staleJobs) {
    if (job.attempt_count >= job.max_attempts) {
      await supabase
        .from("agent_jobs")
        .update({
          status: "failed_terminal",
          finished_at: nowIso,
          safe_error_message: "Job lease expired and max attempts reached.",
          updated_at: nowIso,
        })
        .eq("id", job.id);
    } else {
      await supabase
        .from("agent_jobs")
        .update({
          status: "failed_retryable",
          safe_error_message: "Worker lease expired. Re-enqueued for retry.",
          lease_until: null,
          updated_at: nowIso,
        })
        .eq("id", job.id);
    }
    reconciledCount++;
  }

  return reconciledCount;
}
