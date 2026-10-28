/**
 * Server-side workspace authorization.
 *
 * All domain operations must call these helpers to verify that:
 *   1. A user is authenticated
 *   2. The requested workspace belongs to that user
 *   3. The workspace entitlement permits the requested action
 *
 * This is the second layer of defense after RLS. RLS protects the DB;
 * these functions protect the API/service layer.
 *
 * NEVER accept workspace_id from client input without running
 * requireWorkspaceAccess() or requireWorkspaceEntitlement().
 */

import type { EntitlementType, Workspace } from "@/types/database";
import { createClient } from "@/lib/supabase/server";

// ─── Error types ──────────────────────────────────────────────────────────────

export class AuthError extends Error {
  readonly code = "AUTH_REQUIRED";
  constructor() {
    super("Authentication required.");
    this.name = "AuthError";
  }
}

export class ForbiddenError extends Error {
  readonly code = "FORBIDDEN";
  constructor(message = "You do not have access to this resource.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class EntitlementError extends Error {
  readonly code: string;
  constructor(required: string, actual: string) {
    super(
      `This action requires ${required} entitlement. Current: ${actual}.`
    );
    this.name = "EntitlementError";
    this.code = "SUBSCRIPTION_INACTIVE";
  }
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the authenticated user ID or throws AuthError.
 * Use in every server-side handler that requires authentication.
 */
export async function requireAuth(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new AuthError();
  }

  return user.id;
}

/**
 * Returns the authenticated user's workspace.
 * Throws AuthError if not authenticated.
 * Throws ForbiddenError if the workspace doesn't exist or doesn't belong to the user.
 *
 * NEVER accept workspace_id from client input; always derive it from the session.
 */
export async function requireWorkspace(): Promise<Workspace> {
  const userId = await requireAuth();
  const supabase = await createClient();

  const { data: workspace, error } = await supabase
    .from("workspaces")
    .select("*")
    .eq("owner_user_id", userId)
    .single();

  if (error || !workspace) {
    throw new ForbiddenError("Workspace not found.");
  }

  return workspace as Workspace;
}

/**
 * Returns the workspace and verifies the user is the owner.
 * Additionally verifies that the claimed workspace_id (e.g. from a URL param)
 * matches the authenticated user's workspace.
 *
 * Use this when a client passes a workspace_id in a URL or body — always verify.
 */
export async function requireWorkspaceAccess(
  claimedWorkspaceId: string
): Promise<Workspace> {
  const workspace = await requireWorkspace();

  if (workspace.id !== claimedWorkspaceId) {
    // Cross-workspace access attempt — log as security event in production
    throw new ForbiddenError(
      "You do not have access to this workspace."
    );
  }

  return workspace;
}

// ─── Entitlement checks ───────────────────────────────────────────────────────

const ENTITLEMENT_LEVELS: Record<EntitlementType, number> = {
  inactive:         0,
  draft_only:       1,
  publishing_beta:  2,
  internal_test:    2,  // same level as beta; limited to acceptance-test publish only
  paid_trial:       3,
  paid_active:      3,
};

/**
 * Checks whether an entitlement permits a given capability.
 * Does NOT throw — use in conditional logic.
 */
export function entitlementPermits(
  actual: EntitlementType,
  required: EntitlementType
): boolean {
  return ENTITLEMENT_LEVELS[actual] >= ENTITLEMENT_LEVELS[required];
}

/**
 * Asserts that the workspace's entitlement is at or above the required level.
 * Throws EntitlementError if insufficient.
 */
export function assertEntitlement(
  workspace: Pick<Workspace, "entitlement_type">,
  required: EntitlementType
): void {
  if (!entitlementPermits(workspace.entitlement_type, required)) {
    throw new EntitlementError(required, workspace.entitlement_type);
  }
}

/**
 * Asserts that the workspace's entitlement is EXACTLY one of the allowed types.
 * Used for strict checks like publishing (must be beta or paid, not just any non-draft).
 */
export function assertEntitlementIn(
  workspace: Pick<Workspace, "entitlement_type">,
  allowed: EntitlementType[]
): void {
  if (!allowed.includes(workspace.entitlement_type)) {
    throw new EntitlementError(
      allowed.join(" or "),
      workspace.entitlement_type
    );
  }
}

/**
 * Checks whether publishing is permitted for this workspace.
 * draft_only NEVER gets true — regardless of operating mode or agent state.
 *
 * NOTE: publishing_beta still requires explicit human approval per post;
 * this function only checks the entitlement gate, not approval state.
 */
export function canPublish(workspace: Pick<Workspace, "entitlement_type">): boolean {
  return (
    workspace.entitlement_type === "publishing_beta" ||
    workspace.entitlement_type === "internal_test" ||
    workspace.entitlement_type === "paid_trial" ||
    workspace.entitlement_type === "paid_active"
  );
}

/**
 * Checks whether Autopilot is permitted for this workspace.
 * Only paid workspaces with all autopilot gates passed may use it.
 * Always false during preview/beta.
 */
export function canUseAutopilot(
  workspace: Pick<Workspace, "entitlement_type" | "operating_mode">
): boolean {
  return (
    (workspace.entitlement_type === "paid_trial" ||
      workspace.entitlement_type === "paid_active") &&
    workspace.operating_mode === "autopilot"
  );
}

/**
 * Checks whether scheduling is permitted.
 * Same gate as publishing — draft_only workspaces cannot schedule.
 */
export function canSchedule(workspace: Pick<Workspace, "entitlement_type">): boolean {
  return canPublish(workspace);
}

/**
 * Convenience wrapper: require workspace + assert can publish.
 * Throws AuthError, ForbiddenError, or EntitlementError as appropriate.
 */
export async function requirePublishingAccess(): Promise<Workspace> {
  const workspace = await requireWorkspace();
  if (!canPublish(workspace)) {
    throw new EntitlementError("publishing_beta or paid", workspace.entitlement_type);
  }
  if (workspace.paused_at) {
    throw new ForbiddenError("Agent is paused. Resume before publishing.");
  }
  return workspace;
}
