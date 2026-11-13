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
import { executeAutonomousCycle } from "./intelligence";
import { executeTelegramContentJob } from "@/lib/integrations/telegram/conversation";
import { withTelegramTyping } from "@/lib/integrations/telegram/typing";
import {
  JobTransitionError,
  markJobRetryable,
  markJobTerminal,
  transitionJob,
} from "./state";
import type { AgentJob } from "@/types/database";
import type { JobExecutionResult } from "./types";
import { safeJobErrorMessage } from "./error-message";

export interface ClaimJobsOptions {
  limit?: number;
  leaseMinutes?: number;
  jobTypes?: string[];
}

export interface JobRuntimeBindings {
  browser?: {
    quickAction(
      action: "screenshot",
      options: {
        url: string;
        viewport?: { width: number; height: number };
        screenshotOptions?: { fullPage?: boolean };
        gotoOptions?: { waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2"; timeout?: number };
      }
    ): Promise<Response>;
  };
}

export type JobHandler = (job: AgentJob, supabase: any, runtime?: JobRuntimeBindings) => Promise<JobExecutionResult>;

/** Renew only the exact active attempt and lease; stale workers are fenced out. */
export async function renewAgentJobLease(
  supabase: any,
  jobId: string,
  attemptCount: number,
  expectedLeaseUntil: string
): Promise<string> {
  const nextLeaseUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const { data, error } = await supabase.rpc("renew_agent_job_execution", {
    p_job_id: jobId,
    p_attempt_count: attemptCount,
    p_expected_lease_until: expectedLeaseUntil,
    p_new_lease_until: nextLeaseUntil,
  });
  if (error) {
    throw new JobTransitionError(
      `[runner] Could not renew lease for job ${jobId}: ${error.message}`
    );
  }
  if (data !== true) {
    throw new JobTransitionError(
      `[runner] Lease ownership lost for job ${jobId}; refusing stale execution.`
    );
  }
  return nextLeaseUntil;
}

/**
 * Queue messages cross a trust boundary. Validate the persisted claim envelope
 * before casting or touching the database. Payload-specific validation remains
 * inside each handler, where the job type is known.
 */
export function isClaimedAgentJobEnvelope(value: unknown): value is AgentJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const job = value as Record<string, unknown>;
  const leaseUntil = typeof job.lease_until === "string"
    ? Date.parse(job.lease_until)
    : Number.NaN;

  return (
    typeof job.id === "string" && job.id.length > 0 &&
    typeof job.workspace_id === "string" && job.workspace_id.length > 0 &&
    typeof job.job_type === "string" && job.job_type.length > 0 &&
    job.status === "running" &&
    !!job.payload && typeof job.payload === "object" && !Array.isArray(job.payload) &&
    Number.isInteger(job.attempt_count) && Number(job.attempt_count) > 0 &&
    Number.isInteger(job.max_attempts) && Number(job.max_attempts) > 0 &&
    Number(job.attempt_count) <= Number(job.max_attempts) &&
    Number.isFinite(leaseUntil)
  );
}

/** Registered handlers. Each job_type that may be queued must be present here. */
const handlers: Record<string, JobHandler> = {
  publish_post: (job, supabase) => executePublishJob(job, supabase, { deferJobFinalization: true }),
  agent_cycle: (job, supabase) => executeAutonomousCycle(job, supabase),
  telegram_content_generation: (job, supabase, runtime) => executeTelegramContentJob(job, supabase, runtime?.browser),
};

export function registerJobHandler(jobType: string, handler: JobHandler): void {
  handlers[jobType] = handler;
}

/**
 * A stale Telegram generation job bypasses executeTelegramContentJob(), so
 * its normal conversation cleanup and user notification never run. Recover
 * that state only after the job has been terminalized by the stale-job
 * reconciler. Preserve any already-saved draft and never expose worker errors.
 */
async function recoverTerminalTelegramContentJob(job: AgentJob, supabase: any): Promise<void> {
  const payload = job.payload as Record<string, unknown> | null;
  if (
    job.job_type !== "telegram_content_generation" ||
    !payload ||
    !Number.isSafeInteger(payload.telegramUserId) ||
    !Number.isSafeInteger(payload.chatId)
  ) return;

  const telegramUserId = Number(payload.telegramUserId);
  const chatId = Number(payload.chatId);
  const { data: link, error: linkError } = await supabase
    .from("telegram_links")
    .select("conversation_state")
    .eq("telegram_user_id", telegramUserId)
    .eq("chat_id", chatId)
    .eq("workspace_id", job.workspace_id)
    .is("revoked_at", null)
    .maybeSingle();

  if (linkError) throw new Error("Could not recover the Telegram conversation after a failed job.");
  const currentState = link?.conversation_state && typeof link.conversation_state === "object"
    ? link.conversation_state as Record<string, unknown>
    : {};
  if (!link || currentState.pendingJobId !== job.id) return;

  const nextState: Record<string, unknown> = {
    ...(typeof currentState.activePostId === "string" ? { activePostId: currentState.activePostId } : {}),
    ...(typeof currentState.topic === "string" ? { topic: currentState.topic } : {}),
    ...(typeof currentState.pillar === "string" ? { pillar: currentState.pillar } : {}),
    updatedAt: new Date().toISOString(),
  };
  const { data: cleared, error: clearError } = await supabase.rpc("complete_telegram_conversation_job", {
    p_telegram_user_id: telegramUserId,
    p_chat_id: chatId,
    p_workspace_id: job.workspace_id,
    p_job_id: job.id,
    p_state: nextState,
  });
  if (clearError) throw new Error("Could not clear the failed Telegram conversation state.");
  if (cleared !== true) return;

  // The database status trigger creates a durable, user-safe notification
  // for this terminal Telegram job. Do not send a second direct Telegram
  // message here; the notification dispatcher owns push + Telegram delivery.
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
  supabaseOverride?: any,
  runtimeBindings?: JobRuntimeBindings
): Promise<JobExecutionResult> {
  const supabase = supabaseOverride || createServiceClient();
  const startTime = new Date();

  // Fence: only run a job that is still 'running'. A queue redelivery of a job
  // that already finished, was canceled or was reconciled must not run again.
  const { data: current, error: readErr } = await supabase
    .from("agent_jobs")
    .select("id, status, attempt_count, max_attempts, lease_until")
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
  const expectedLeaseUntil = job.lease_until;
  if (!expectedLeaseUntil || current.lease_until !== expectedLeaseUntil) {
    return {
      jobId: job.id,
      success: false,
      status: "running",
      retryable: false,
      error: "Duplicate or expired queue delivery skipped; another execution owns the lease.",
    };
  }

  const renewedLeaseUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const { data: executionStarted, error: executionStartError } = await supabase.rpc("begin_agent_job_execution", {
    p_job_id: job.id,
    p_attempt_count: attemptCount,
    p_expected_lease_until: expectedLeaseUntil,
    p_new_lease_until: renewedLeaseUntil,
  });
  if (executionStartError) {
    throw new JobTransitionError(
      `[runner] Could not acquire execution lease for job ${job.id}: ${executionStartError.message}`
    );
  }
  if (executionStarted !== true) {
    return {
      jobId: job.id,
      success: false,
      status: "running",
      retryable: false,
      error: "Duplicate or expired queue delivery skipped; another execution owns the lease.",
    };
  }

  const liveJob = {
    ...job,
    attempt_count: attemptCount,
    max_attempts: maxAttempts,
    lease_until: renewedLeaseUntil,
  } as AgentJob;
  const jobGuard = () => ({
    attemptCount,
    leaseUntil: liveJob.lease_until ?? undefined,
  });

  let result: JobExecutionResult;
  let heartbeatInFlight: Promise<void> | null = null;
  let leaseLost = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  heartbeatTimer = setInterval(() => {
    if (heartbeatInFlight || leaseLost || !liveJob.lease_until) return;
    heartbeatInFlight = renewAgentJobLease(
      supabase,
      liveJob.id,
      attemptCount,
      liveJob.lease_until
    ).then((nextLeaseUntil) => {
      liveJob.lease_until = nextLeaseUntil;
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "Unknown lease renewal error";
      if (message.includes("Lease ownership lost")) {
        leaseLost = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
      }
      console.error(`[runner] Lease heartbeat failed for job ${liveJob.id}: ${message}`);
    }).finally(() => {
      heartbeatInFlight = null;
    });
  }, 60 * 1000);

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
      const execute = () => handler(liveJob, supabase, runtimeBindings);
      const telegramChatId = (liveJob.payload as Record<string, unknown> | null)?.chatId;
      result = typeof telegramChatId === "number" && Number.isSafeInteger(telegramChatId)
        ? await withTelegramTyping(telegramChatId, execute)
        : await execute();
    }
  } catch (err: any) {
    console.error("[runner] Job handler failed:", { jobId: liveJob.id, error: err });
    result = {
      jobId: liveJob.id,
      success: false,
      status: "failed_retryable",
      retryable: true,
      error: err?.message || "Unexpected runner error",
    };
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (heartbeatInFlight) await heartbeatInFlight;
  }

  // A newer claim fences this execution out. A handler may have completed an
  // external side effect just before losing its lease; its domain-level
  // idempotency/reconciliation path remains responsible for that outcome.
  const { data: ownership, error: ownershipError } = await supabase
    .from("agent_jobs")
    .select("status, attempt_count, lease_until")
    .eq("id", liveJob.id)
    .single();

  if (ownershipError || !ownership) {
    throw new JobTransitionError(
      `[runner] Could not verify lease ownership for job ${liveJob.id}: ${ownershipError?.message ?? "not found"}`
    );
  }

  const stillOwnsRunningLease =
    ownership.status !== "running" ||
    (
      ownership.attempt_count === attemptCount &&
      !leaseLost &&
      ownership.lease_until === liveJob.lease_until &&
      Date.parse(ownership.lease_until) > Date.now()
    );
  if (ownership.attempt_count !== attemptCount || !stillOwnsRunningLease) {
    return {
      jobId: liveJob.id,
      success: false,
      status: ownership.status,
      retryable: false,
      error: "Worker lease was lost; this execution did not finalize the job.",
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

  if (result.error) console.error("[runner] Job execution returned an error:", { jobId: liveJob.id, error: result.error });
  const safeError = result.error ? safeJobErrorMessage(result.error) : null;

  if (after.status === "running") {
    if (result.success) {
      await transitionJob(supabase, liveJob.id, "running", "succeeded", {
        finished_at: finishedTime.toISOString(),
        lease_until: null,
        safe_error_message: null,
      }, jobGuard());
    } else if (result.status === "canceled") {
      await transitionJob(supabase, liveJob.id, "running", "canceled", {
        finished_at: finishedTime.toISOString(),
        lease_until: null,
        last_error_code: "JOB_CANCELED",
        safe_error_message: safeError ?? "This task was stopped by a safety check.",
      }, jobGuard());
    } else if (result.status === "needs_reconciliation") {
      await transitionJob(supabase, liveJob.id, "running", "needs_reconciliation", {
        lease_until: null,
        last_error_code: "NEEDS_RECONCILIATION",
        safe_error_message: safeError ?? "We couldn’t confirm the outcome. Please review the post before trying again.",
      }, jobGuard());
    } else if (result.retryable && attemptCount < maxAttempts) {
      await markJobRetryable(
        supabase,
        { id: liveJob.id, attempt_count: attemptCount },
        safeError ?? "Nunuza couldn’t complete this task. It will try again when possible.",
        "RETRYABLE_ERROR",
        "running",
        jobGuard()
      );
    } else {
      await markJobTerminal(
        supabase,
        liveJob.id,
        safeError ?? "Nunuza couldn’t complete this task. Please try again.",
        "TERMINAL_ERROR",
        "running",
        jobGuard()
      );
    }
  } else if (result.success && after.status !== "succeeded") {
    // Handler reported success but the persisted state disagrees: never report success.
    throw new JobTransitionError(
      `[runner] Job ${liveJob.id} reported success but is persisted as '${after.status}'.`
    );
  }

  return result.error ? { ...result, error: safeError ?? "Nunuza couldn’t complete this task. Please try again." } : result;
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
  let reconciledCount = 0;

  for (const job of staleJobs as AgentJob[]) {
    try {
      if (job.job_type === "publish_post") {
        const postId = (job.payload as any)?.postId as string | undefined;
        let postStatus: string | null = null;
        let postLinkedInId: string | null = null;
        if (postId) {
          const { data: post, error: postErr } = await supabase
            .from("content_posts")
            .select("status, linkedin_post_id")
            .eq("id", postId)
            .eq("workspace_id", job.workspace_id)
            .single();
          if (postErr || !post) {
            throw new Error(`Could not read post ${postId}: ${postErr?.message ?? "not found"}`);
          }
          postStatus = post.status;
          postLinkedInId = post.linkedin_post_id ?? null;
        }

        if (postStatus === "published") {
          if (!postLinkedInId) {
            await transitionJob(supabase, job.id, "running", "needs_reconciliation", {
              lease_until: null,
              last_error_code: "PUBLISHED_POST_ID_MISSING",
              safe_error_message: "We couldn’t confirm the published post. Check your LinkedIn profile and confirm its status in Nunuza.",
            }, { attemptCount: job.attempt_count, leaseUntil: job.lease_until ?? undefined });
          } else {
            await transitionJob(supabase, job.id, "running", "succeeded", {
              finished_at: nowIso,
              lease_until: null,
              safe_error_message: null,
            }, { attemptCount: job.attempt_count, leaseUntil: job.lease_until ?? undefined });
          }
          reconciledCount++;
          continue;
        }

        if (postStatus === "publishing" || postStatus === "needs_reconciliation") {
          // Fence out the expired worker first. A heartbeat that renewed the
          // lease after the stale scan must win over this recovery attempt.
          await transitionJob(supabase, job.id, "running", "needs_reconciliation", {
            lease_until: null,
            last_error_code: "WORKER_DIED_DURING_PUBLISH",
            safe_error_message:
              "The worker stopped while publishing. The post may already be live on LinkedIn. Check your LinkedIn profile and confirm the outcome in Nunuza.",
          }, { attemptCount: job.attempt_count, leaseUntil: job.lease_until ?? undefined });

          if (postId && postStatus === "publishing") {
            const { data: updatedPost, error: postUpdErr } = await supabase
              .from("content_posts")
              .update({
                status: "needs_reconciliation",
                updated_at: nowIso,
                ...(typeof (job.payload as any)?.linkedin_post_urn === "string" &&
                    (job.payload as any).linkedin_post_urn.startsWith("urn:li:")
                  ? { linkedin_post_id: (job.payload as any).linkedin_post_urn }
                  : {}),
              })
              .eq("id", postId)
              .eq("workspace_id", job.workspace_id)
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
                .eq("workspace_id", job.workspace_id)
                .single();
              if (latestErr || latestPost?.status !== "needs_reconciliation") {
                throw new Error(
                  `Post ${postId} changed before reconciliation could be persisted.`
                );
              }
            }
          }
          reconciledCount++;
          continue;
        }
      }

      if (job.job_type === "telegram_content_generation" && job.attempt_count >= job.max_attempts) {
        // A claim that never produced an attempt record means the worker died
        // before completing a durable execution. Give it exactly one grace
        // attempt instead of exhausting the user's generation retries.
        const { data: recordedAttempt, error: attemptLookupError } = await supabase
          .from("agent_job_attempts")
          .select("id")
          .eq("job_id", job.id)
          .eq("attempt_number", job.attempt_count)
          .maybeSingle();
        if (attemptLookupError) {
          throw new Error(`Could not verify Telegram job attempt history: ${attemptLookupError.message}`);
        }
        if (!recordedAttempt) {
          await transitionJob(supabase, job.id, "running", "failed_retryable", {
            max_attempts: job.attempt_count + 1,
            scheduled_for: nowIso,
            lease_until: null,
            last_error_code: "WORKER_INTERRUPTED_BEFORE_ATTEMPT_RECORD",
            safe_error_message: "The previous worker stopped before finishing. Nunuza will retry your request once more.",
          }, { attemptCount: job.attempt_count, leaseUntil: job.lease_until ?? undefined });
          reconciledCount++;
          continue;
        }
      }

      if (job.attempt_count >= job.max_attempts) {
        await markJobTerminal(
          supabase,
          job.id,
          "This task was interrupted repeatedly and could not be completed. Any saved draft is preserved.",
          "LEASE_EXPIRED_MAX_ATTEMPTS",
          "running",
          { attemptCount: job.attempt_count, leaseUntil: job.lease_until ?? undefined }
        );
        if (job.job_type === "telegram_content_generation") {
          await recoverTerminalTelegramContentJob(job, supabase);
        }
      } else {
        await transitionJob(supabase, job.id, "running", "failed_retryable", {
          scheduled_for: nowIso,
          lease_until: null,
          last_error_code: "LEASE_EXPIRED",
          safe_error_message: "A task was interrupted and has been queued to try again.",
        }, { attemptCount: job.attempt_count, leaseUntil: job.lease_until ?? undefined });
      }
      reconciledCount++;
    } catch (err: any) {
      // One bad job must not stop reconciliation of the others, but it must be visible.
      console.error(`[runner] Failed to reconcile stale job ${job.id}: ${err?.message}`);
    }
  }

  // Repair a previous partial reconciliation where the job was safely
  // closed but the post status update failed. Only touch publishing posts
  // whose own job is already awaiting human reconciliation.
  const { data: reconciliationJobs, error: reconciliationJobsError } = await supabase
    .from("agent_jobs")
    .select("workspace_id, payload")
    .eq("job_type", "publish_post")
    .eq("status", "needs_reconciliation")
    .limit(100);

  if (reconciliationJobsError) {
    throw new Error(`[runner] Reconciliation repair lookup failed: ${reconciliationJobsError.message}`);
  }

  for (const reconciliationJob of reconciliationJobs ?? []) {
    const postId = (reconciliationJob.payload as any)?.postId as string | undefined;
    if (!postId || !reconciliationJob.workspace_id) continue;

    const { data: post, error: postReadError } = await supabase
      .from("content_posts")
      .select("status, linkedin_post_id")
      .eq("id", postId)
      .eq("workspace_id", reconciliationJob.workspace_id)
      .maybeSingle();

    const confirmedUrn = typeof (reconciliationJob.payload as any)?.linkedin_post_urn === "string" &&
      (reconciliationJob.payload as any).linkedin_post_urn.startsWith("urn:li:")
      ? (reconciliationJob.payload as any).linkedin_post_urn as string
      : null;
    if (postReadError || !post) continue;
    const needsStatusRepair = post.status === "publishing";
    const needsUrnRepair = Boolean(confirmedUrn && !post.linkedin_post_id &&
      ["publishing", "needs_reconciliation"].includes(post.status));
    if (!needsStatusRepair && !needsUrnRepair) continue;

    const { data: repairedPost, error: repairError } = await supabase
      .from("content_posts")
      .update({
        status: "needs_reconciliation",
        updated_at: nowIso,
        ...(confirmedUrn ? { linkedin_post_id: confirmedUrn } : {}),
      })
      .eq("id", postId)
      .eq("workspace_id", reconciliationJob.workspace_id)
      .eq("status", post.status)
      .select("id");

    if (repairError) {
      console.error(`[runner] Could not repair reconciliation state for post ${postId}: ${repairError.message}`);
      continue;
    }
    if (Array.isArray(repairedPost) && repairedPost.length > 0) reconciledCount++;
  }

  return reconciledCount;
}
