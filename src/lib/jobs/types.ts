/**
 * Job Scheduler & Queue Types.
 *
 * Backed by Supabase `agent_jobs` table and dispatched via Cloudflare Queues/Cron.
 */

import type { JobStatus } from "@/types/database";

// Job types executed by the v1 durable worker. Planning remains user-invoked,
// reconciliation is user-confirmed, and LinkedIn metrics remain unavailable
// until the required official LinkedIn analytics permission is granted.
export type AgentJobType = "publish_post" | "agent_cycle" | "telegram_content_generation";

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
