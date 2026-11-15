/**
 * Operator alerts for jobs that ended in failed_terminal.
 *
 * Sends one Telegram message per failed job to OPS_ALERT_TELEGRAM_CHAT_ID and
 * records an audit event so a job is never alerted twice. Messages contain only
 * the job type, workspace name and Nunuza's own safe error text, never customer
 * content. If the chat id is not configured this does nothing.
 */

import { createServiceClient } from "@/lib/supabase/server";

const LOOKBACK_MS = 3 * 60 * 60 * 1000;
const MAX_ALERTS_PER_PASS = 5;

export interface FailedJobRow {
  id: string;
  workspace_id: string;
  job_type: string;
  safe_error_message: string | null;
  last_error_code: string | null;
  finished_at: string | null;
  attempt_count?: number | null;
  max_attempts?: number | null;
}

const JOB_LABELS: Record<string, string> = {
  agent_cycle: "Daily cycle (finds a story and drafts it)",
  publish_post: "Publish to LinkedIn",
  telegram_content_generation: "Draft from a Telegram message",
};

function formatUtc(value: string | null): string {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "unknown time";
  return date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function buildFailureAlert(job: FailedJobRow, workspaceName: string): string {
  const reason = (job.safe_error_message || job.last_error_code || "No reason recorded").slice(0, 200);
  const attempts = job.attempt_count && job.max_attempts ? `${job.attempt_count} of ${job.max_attempts}` : "unknown";
  return [
    "\u{1F6A8} [NUNUZA ADMIN] Job FAILED",
    `Job: ${JOB_LABELS[job.job_type] ?? job.job_type} (${job.job_type})`,
    `Workspace: ${workspaceName}`,
    `Reason: ${reason}`,
    `Error code: ${job.last_error_code ?? "none"}`,
    `Attempts used: ${attempts}`,
    `Failed at: ${formatUtc(job.finished_at)}`,
    `Job id: ${job.id.slice(0, 8)}`,
  ].join("\n");
}

/** Jobs from `failed` that have no matching id in `alertedIds`, oldest first, capped. */
export function selectUnalerted(failed: FailedJobRow[], alertedIds: Set<string>, max = MAX_ALERTS_PER_PASS): FailedJobRow[] {
  return failed
    .filter((job) => !alertedIds.has(job.id))
    .sort((a, b) => String(a.finished_at).localeCompare(String(b.finished_at)))
    .slice(0, max);
}

async function sendOpsMessage(chatId: string, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function alertFailedJobs(supabaseOverride?: any): Promise<{ sent: number }> {
  const chatId = process.env.OPS_ALERT_TELEGRAM_CHAT_ID?.trim();
  if (!chatId) return { sent: 0 };

  const supabase = supabaseOverride ?? createServiceClient();
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();

  const { data: failed, error } = await supabase
    .from("agent_jobs")
    .select("id, workspace_id, job_type, safe_error_message, last_error_code, finished_at, attempt_count, max_attempts")
    .eq("status", "failed_terminal")
    .gte("finished_at", since)
    .order("finished_at", { ascending: true })
    .limit(50);
  if (error || !failed?.length) return { sent: 0 };

  const { data: sentEvents } = await supabase
    .from("audit_events")
    .select("safe_metadata")
    .eq("action", "ops_alert_sent")
    .gte("created_at", since)
    .limit(200);
  const alertedIds = new Set<string>(
    (sentEvents ?? []).map((event: any) => String(event.safe_metadata?.jobId ?? "")).filter(Boolean)
  );

  let sent = 0;
  for (const job of selectUnalerted(failed as FailedJobRow[], alertedIds)) {
    const { data: workspace } = await supabase.from("workspaces").select("name").eq("id", job.workspace_id).maybeSingle();
    const delivered = await sendOpsMessage(chatId, buildFailureAlert(job, workspace?.name ?? "Unknown workspace"));
    if (!delivered) continue;
    sent += 1;
    await supabase.from("audit_events").insert({
      workspace_id: job.workspace_id,
      actor_type: "system",
      action: "ops_alert_sent",
      resource_type: "agent_job",
      resource_id: job.id,
      safe_metadata: { jobId: job.id, jobType: job.job_type },
    });
  }
  return { sent };
}
