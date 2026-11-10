/**
 * Job Scheduler & Queue Types.
 *
 * Backed by Supabase `agent_jobs` table and dispatched via Cloudflare Queues/Cron.
 */

import type { JobStatus } from "@/types/database";

// Only jobs actually enqueued by the v1 background worker. Planning remains
// user-invoked, reconciliation is user-confirmed, and LinkedIn metrics are
// unavailable under the current restricted r_member_social permission.
export type AgentJobType = "publish_post" | "agent_cycle";

export interface PublishPostPayload {
  postId: string;
  workspaceId: string;
  userId: string;
  targetProvider: "linkedin";
  scheduledFor: string;
}

export interface ReconcilePostPayload {
  postId: string;
  workspaceId: string;
  publishJobId: string;
  originalAttemptAt: string;
}

export interface JobExecutionResult {
  jobId: string;
  success: boolean;
  status: JobStatus;
  retryable: boolean;
  error?: string;
  postUrn?: string;
}
