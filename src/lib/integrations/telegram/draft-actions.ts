/**
 * Approve and reject a draft on behalf of a linked Telegram user.
 *
 * One implementation for every Telegram surface (chat buttons and the "Read
 * full post" Mini App) so the rules never drift: entitlement check, workspace
 * ownership, status guard, learning signal, audit event and scheduling.
 */

import { scheduleApprovedPost, APPROVAL_LEAD_MS } from "@/lib/jobs/agent-scheduling";

export function canPublishEntitlement(entitlement: string): boolean {
  return ["internal_beta", "publishing_beta", "internal_test", "paid_trial", "paid_active"].includes(entitlement);
}

export type ApproveSource = "telegram_callback" | "telegram_webapp";

export type ApproveResult =
  | { kind: "restricted" }
  | { kind: "not_found" }
  | { kind: "not_approvable" }
  | { kind: "scheduled"; postId: string; title: string; scheduledFor: string; timezone?: string }
  | { kind: "approved_unscheduled"; postId: string; title: string; reason: string };

export async function approveDraft(
  supabase: any,
  input: { workspaceId: string; postId: string; entitlement: string; source: ApproveSource }
): Promise<ApproveResult> {
  const { workspaceId, postId, entitlement, source } = input;
  if (!canPublishEntitlement(entitlement)) return { kind: "restricted" };

  // The post must belong to this workspace.
  const { data: post } = await supabase
    .from("content_posts")
    .select("id, status, internal_title")
    .eq("id", postId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!post) return { kind: "not_found" };

  const { data: approvedRows, error: approveErr } = await supabase
    .from("content_posts")
    .update({ status: "approved" })
    .eq("id", post.id)
    .eq("workspace_id", workspaceId)
    .in("status", ["draft", "needs_review"])
    .select("id");
  if (approveErr || !approvedRows || approvedRows.length === 0) return { kind: "not_approvable" };

  const { error: signalError } = await supabase.from("approval_events").insert({
    workspace_id: workspaceId, post_id: post.id, actor_type: "telegram", action: "approved",
  });
  if (signalError) console.error("[telegram] Approval learning signal failed:", signalError.message);

  await supabase.from("audit_events").insert({
    workspace_id: workspaceId,
    actor_type: "telegram",
    action: "post_approved",
    resource_type: "content_post",
    resource_id: post.id,
    safe_metadata: { source },
  });

  const title = post.internal_title || "Post";
  // Approval means "publish this": put it on the next preferred slot instead of
  // leaving it parked. The user can still cancel the schedule afterwards.
  const { data: ownerRow } = await supabase.from("workspaces").select("owner_user_id").eq("id", workspaceId).maybeSingle();
  const scheduled = ownerRow?.owner_user_id
    ? await scheduleApprovedPost(supabase, {
        workspaceId, ownerUserId: ownerRow.owner_user_id, postId: post.id,
        minLeadMs: APPROVAL_LEAD_MS, autopilot: false,
      })
    : { ok: false as const, reason: "WORKSPACE_ACCESS_DENIED" };

  if (scheduled.ok) {
    await supabase.from("audit_events").insert({
      workspace_id: workspaceId, actor_type: "telegram", action: "schedule_post",
      resource_type: "content_post", resource_id: post.id,
      safe_metadata: { source, scheduledFor: scheduled.scheduledFor },
    });
    return { kind: "scheduled", postId: post.id, title, scheduledFor: scheduled.scheduledFor, timezone: scheduled.timezone };
  }
  return { kind: "approved_unscheduled", postId: post.id, title, reason: scheduled.reason };
}

export type RejectResult =
  | { kind: "not_found" }
  | { kind: "not_rejectable" }
  | { kind: "rejected"; postId: string; title: string };

export async function rejectDraft(
  supabase: any,
  input: { workspaceId: string; postId: string; source: ApproveSource }
): Promise<RejectResult> {
  const { workspaceId, postId, source } = input;
  const { data: post } = await supabase
    .from("content_posts")
    .select("id, internal_title")
    .eq("id", postId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!post) return { kind: "not_found" };

  const { data: rejectedRows, error: rejectError } = await supabase
    .from("content_posts")
    .update({ status: "rejected" })
    .eq("id", post.id)
    .eq("workspace_id", workspaceId)
    .in("status", ["draft", "needs_review"])
    .select("id");
  if (rejectError || !rejectedRows?.length) return { kind: "not_rejectable" };

  const reason = source === "telegram_webapp" ? "Rejected in the Telegram reader" : "Rejected via Telegram";
  const { error: signalError } = await supabase.from("approval_events").insert({
    workspace_id: workspaceId, post_id: post.id, actor_type: "telegram", action: "rejected", reason,
  });
  if (signalError) console.error("[telegram] Rejection learning signal failed:", signalError.message);

  await supabase.from("audit_events").insert({
    workspace_id: workspaceId,
    actor_type: "telegram",
    action: "post_rejected",
    resource_type: "content_post",
    resource_id: post.id,
    safe_metadata: { reason },
  });
  return { kind: "rejected", postId: post.id, title: post.internal_title || "Post" };
}
