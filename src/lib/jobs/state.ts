/**
 * Explicit, checked job state transitions.
 *
 * Every write to agent_jobs.status goes through transitionJob(), which:
 *  - validates the transition against the allowed state machine,
 *  - uses compare-and-set (WHERE status = <from>) so a stale worker cannot
 *    overwrite a newer state,
 *  - throws if the database reports an error or no row was updated.
 *
 * Nothing here silently ignores a failed update.
 */

import type { JobStatus } from "@/types/database";

export class JobTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobTransitionError";
  }
}

const ALLOWED_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  queued: ["running", "canceled", "waiting_for_approval"],
  waiting_for_approval: ["queued", "canceled"],
  running: [
    "succeeded",
    "failed_retryable",
    "failed_terminal",
    "needs_reconciliation",
    "canceled",
    "waiting_for_approval",
  ],
  failed_retryable: ["running", "canceled", "failed_terminal"],
  // Terminal states. needs_reconciliation can only be resolved by a human decision.
  succeeded: [],
  failed_terminal: [],
  canceled: [],
  needs_reconciliation: ["succeeded", "canceled", "failed_terminal"],
};

export function isAllowedTransition(from: JobStatus, to: JobStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Exponential backoff in seconds: 2^attempt minutes, capped at one hour. */
export function backoffSeconds(attempt: number): number {
  return Math.min(Math.pow(2, Math.max(attempt, 1)) * 60, 3600);
}

/**
 * Moves a job from one status to another using compare-and-set.
 * Throws JobTransitionError if the transition is illegal, the database errors,
 * or the job was no longer in the expected status.
 */
export interface JobTransitionGuard {
  attemptCount?: number;
  leaseUntil?: string;
}

export async function transitionJob(
  supabase: any,
  jobId: string,
  from: JobStatus,
  to: JobStatus,
  patch: Record<string, unknown> = {},
  guard?: JobTransitionGuard
): Promise<void> {
  if (!isAllowedTransition(from, to)) {
    throw new JobTransitionError(`Illegal job transition ${from} -> ${to} for job ${jobId}.`);
  }

  let query = supabase
    .from("agent_jobs")
    .update({ ...patch, status: to, updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("status", from);

  if (guard?.attemptCount !== undefined) {
    query = query.eq("attempt_count", guard.attemptCount);
  }
  if (guard?.leaseUntil !== undefined) {
    query = query.eq("lease_until", guard.leaseUntil);
  }

  const { data, error } = await query.select("id");

  if (error) {
    throw new JobTransitionError(
      `Database error moving job ${jobId} ${from} -> ${to}: ${error.message}`
    );
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new JobTransitionError(
      `Job ${jobId} was not in status '${from}'; refusing to move it to '${to}'.`
    );
  }
}

/** Retryable failure: requeue after exponential backoff, releasing the lease. */
export async function markJobRetryable(
  supabase: any,
  job: { id: string; attempt_count: number },
  message: string,
  errorCode: string,
  from: JobStatus = "running",
  guard?: JobTransitionGuard
): Promise<string> {
  const nextRunIso = new Date(Date.now() + backoffSeconds(job.attempt_count) * 1000).toISOString();
  await transitionJob(supabase, job.id, from, "failed_retryable", {
    scheduled_for: nextRunIso,
    lease_until: null,
    last_error_code: errorCode,
    safe_error_message: message,
  }, guard);
  return nextRunIso;
}

/** Terminal failure. */
export async function markJobTerminal(
  supabase: any,
  jobId: string,
  message: string,
  errorCode: string,
  from: JobStatus = "running",
  guard?: JobTransitionGuard
): Promise<void> {
  await transitionJob(supabase, jobId, from, "failed_terminal", {
    finished_at: new Date().toISOString(),
    lease_until: null,
    last_error_code: errorCode,
    safe_error_message: message,
  }, guard);
}
