/**
 * Scheduling used by the agent itself (Autopilot and Telegram approval).
 *
 * Both go through the same atomic database functions as the dashboard, so
 * entitlement, pause state, daily/weekly caps and job idempotency are enforced
 * in one place. These helpers take a service client because the caller is a
 * worker or a verified Telegram chat rather than a browser session.
 */
import { nextPublishTime } from "./publish-time";

export const AUTOPILOT_VETO_WINDOW_MS = 15 * 60_000;
export const APPROVAL_LEAD_MS = 5 * 60_000;

export type AgentScheduleResult =
  | { ok: true; scheduledFor: string }
  | { ok: false; reason: string };

export function formatScheduledTime(iso: string, timezone?: string | null): string {
  let zone = "UTC";
  try {
    if (timezone) { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); zone = timezone; }
  } catch { /* fall back to UTC */ }
  const text = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(iso));
  return `${text} (${zone})`;
}

export async function loadPublishPreferences(supabase: any, workspaceId: string) {
  const { data } = await supabase.from("content_strategies")
    .select("preferred_time, preferred_days, timezone").eq("workspace_id", workspaceId).maybeSingle();
  return {
    preferredTime: data?.preferred_time ?? null,
    preferredDays: data?.preferred_days ?? null,
    timezone: data?.timezone ?? "UTC",
  };
}

/** Schedules an APPROVED post at the workspace's next preferred slot. */
export async function scheduleApprovedPost(
  supabase: any,
  input: { workspaceId: string; ownerUserId: string; postId: string; minLeadMs: number; autopilot: boolean; now?: Date }
): Promise<AgentScheduleResult & { timezone?: string }> {
  const preferences = await loadPublishPreferences(supabase, input.workspaceId);
  const at = nextPublishTime(input.now ?? new Date(), preferences, input.minLeadMs).toISOString();
  const { data, error } = await supabase.rpc("schedule_post_atomic", {
    p_workspace_id: input.workspaceId,
    p_post_id: input.postId,
    p_owner_user_id: input.ownerUserId,
    p_scheduled_for: at,
  });
  if (error) return { ok: false, reason: "RPC_ERROR" };
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.success) return { ok: false, reason: String(result?.reason ?? "SCHEDULING_NOT_CONFIRMED") };

  if (input.autopilot && result.job?.id) {
    // Fail closed: the publish worker re-checks mode, pause and caps for
    // Autopilot jobs. A failed patch must not leave an unmarked job behind.
    const payload = { ...(result.job.payload ?? {}), autopilot: true };
    const { error: patchError } = await supabase.from("agent_jobs")
      .update({ payload }).eq("id", result.job.id).eq("status", "queued");
    if (patchError) {
      await cancelScheduledPostByAgent(supabase, input.workspaceId, input.postId);
      return { ok: false, reason: "AUTOPILOT_MARK_FAILED" };
    }
  }
  return { ok: true, scheduledFor: at, timezone: preferences.timezone };
}

/** Cancels a scheduled post's job before it is claimed. Post returns to approved. */
export async function cancelScheduledPostByAgent(
  supabase: any, workspaceId: string, postId: string
): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await supabase.rpc("cancel_scheduled_post_atomic", {
    p_workspace_id: workspaceId, p_post_id: postId,
  });
  if (error) return { ok: false, reason: "RPC_ERROR" };
  const result = Array.isArray(data) ? data[0] : data;
  return result?.success ? { ok: true } : { ok: false, reason: String(result?.reason ?? "NOT_CANCELLED") };
}
