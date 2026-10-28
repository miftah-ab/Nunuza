/**
 * Job Scheduler & Queue Types.
 *
 * Backed by Supabase `agent_jobs` table and dispatched via Cloudflare Queues/Cron.
 */

import type { JobStatus } from "@/types/database";

export type AgentJobType = "publish_post" | "generate_plan" | "reconcile_post" | "sync_metrics";

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
