import { createServiceClient } from "@/lib/supabase/server";
import { decryptToken } from "@/lib/integrations/linkedin/crypto";
import { LINKEDIN_API_VERSION } from "@/lib/integrations/linkedin/client";
import { ENGAGEMENT_WRITE_SCOPE } from "./engagement";

export async function publishApprovedEngagementAction(actionId: string, dbOverride?: any): Promise<{
  status: "published" | "blocked" | "needs_reconciliation" | "failed";
  reason?: string;
}> {
  const db = dbOverride || createServiceClient();
  const { data: action, error } = await db.from("engagement_actions").select("*").eq("id", actionId).maybeSingle();
  if (error || !action) return { status: "failed", reason: "action_not_found" };
  if (action.status !== "approved" || !action.approval_hash || action.approval_hash !== action.draft_hash) {
    return { status: "blocked", reason: "approval_missing_or_draft_changed" };
  }
  if (Date.parse(action.expires_at) <= Date.now()) {
    await db.from("engagement_actions").update({ status: "expired" }).eq("id", actionId).eq("status", "approved");
    return { status: "blocked", reason: "approval_expired" };
  }
  const { data: connection } = await db.from("integration_connections")
    .select("status,expires_at,granted_scopes,encrypted_token_ref,external_account_id")
    .eq("workspace_id", action.workspace_id).eq("provider", "linkedin").maybeSingle();
  if (!connection || connection.status !== "connected" || !connection.encrypted_token_ref ||
      !Array.isArray(connection.granted_scopes) || !connection.granted_scopes.includes(ENGAGEMENT_WRITE_SCOPE)) {
    return { status: "blocked", reason: "linkedin_comment_write_permission_not_granted" };
  }
  if (connection.expires_at && Date.parse(connection.expires_at) <= Date.now()) {
    return { status: "blocked", reason: "linkedin_connection_expired" };
  }
  if (typeof action.parent_post_urn !== "string" || !/^urn:li:(activity|share|ugcPost):[A-Za-z0-9:(),_-]+$/.test(action.parent_post_urn)) {
    return { status: "failed", reason: "invalid_parent_post_urn" };
  }
  if (action.action_type === "reply" && (typeof action.parent_comment_urn !== "string" || !action.parent_comment_urn.startsWith("urn:li:comment:"))) {
    return { status: "failed", reason: "invalid_parent_comment_urn" };
  }
  const { data: claimed, error: claimError } = await db.from("engagement_actions")
    .update({ status: "publishing", updated_at: new Date().toISOString() })
    .eq("id", actionId).eq("status", "approved").eq("draft_hash", action.draft_hash)
    .eq("approval_hash", action.draft_hash).select("id");
  if (claimError || !claimed?.length) return { status: "blocked", reason: "action_already_claimed_or_changed" };

  const target = action.action_type === "reply" ? action.parent_comment_urn : action.parent_post_urn;
  let response: Response;
  try {
    response = await fetch(`https://api.linkedin.com/rest/socialActions/${encodeURIComponent(target)}/comments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${decryptToken(connection.encrypted_token_ref)}`,
        "LinkedIn-Version": LINKEDIN_API_VERSION,
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        actor: connection.external_account_id,
        object: action.parent_post_urn,
        message: { text: action.draft_text },
        ...(action.action_type === "reply" ? { parentComment: action.parent_comment_urn } : {}),
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    await db.from("engagement_actions").update({
      status: "needs_reconciliation", failure_code: "LINKEDIN_OUTCOME_UNKNOWN",
      safe_failure_message: "LinkedIn did not confirm whether the comment was created.",
      updated_at: new Date().toISOString(),
    }).eq("id", actionId).eq("status", "publishing");
    return { status: "needs_reconciliation", reason: "provider_outcome_unknown" };
  }
  if (!response.ok) {
    const ambiguous = response.status >= 500;
    await db.from("engagement_actions").update({
      status: ambiguous ? "needs_reconciliation" : "failed",
      failure_code: ambiguous ? "LINKEDIN_SERVER_OUTCOME_UNKNOWN" : "LINKEDIN_REJECTED",
      safe_failure_message: ambiguous ? "Check LinkedIn before retrying this action." : `LinkedIn rejected the comment (HTTP ${response.status}).`,
      updated_at: new Date().toISOString(),
    }).eq("id", actionId).eq("status", "publishing");
    return { status: ambiguous ? "needs_reconciliation" : "failed", reason: ambiguous ? "provider_outcome_unknown" : "provider_rejected" };
  }
  const providerId = response.headers.get("x-restli-id");
  if (!providerId || !/^\d+$/.test(providerId)) {
    await db.from("engagement_actions").update({
      status: "needs_reconciliation", failure_code: "LINKEDIN_COMMENT_ID_MISSING",
      safe_failure_message: "LinkedIn accepted the request but did not return a verifiable comment ID.",
      updated_at: new Date().toISOString(),
    }).eq("id", actionId).eq("status", "publishing");
    return { status: "needs_reconciliation", reason: "provider_id_missing" };
  }
  const commentUrn = `urn:li:comment:(${action.parent_post_urn},${providerId})`;
  const { error: persistError } = await db.from("engagement_actions").update({
    status: "published", published_comment_urn: commentUrn,
    published_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    failure_code: null, safe_failure_message: null,
  }).eq("id", actionId).eq("status", "publishing");
  if (persistError) return { status: "needs_reconciliation", reason: "published_but_local_persistence_failed" };
  return { status: "published" };
}
