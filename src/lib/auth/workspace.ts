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

import type { AccessMode, EntitlementType, Workspace } from "@/types/database";
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
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new AuthError();
  }

  const { data: workspace, error } = await supabase
    .from("workspaces")
    .select("*")
    .eq("owner_user_id", user.id)
    .single();

  if (!error && workspace) {
    return workspace as Workspace;
  }

  // Self-healing provisioning fallback:
  // If user is authenticated but workspace row was not provisioned (e.g. signup trigger was absent when user registered),
  // provision their profile and draft_only workspace via service role.
  try {
    const { createServiceClient } = await import("@/lib/supabase/server");
    const serviceClient = createServiceClient();

    const email = user.email ?? "";
    const baseName = email.split("@")[0] || "User";

    // Ensure profile exists
    await serviceClient.from("profiles").upsert(
      {
        id: user.id,
        display_name: (user.user_metadata?.full_name as string) || (user.user_metadata?.name as string) || baseName,
        timezone: "UTC",
      },
      { onConflict: "id" }
    );

    // Create workspace
    const { data: newWs, error: wsErr } = await serviceClient
      .from("workspaces")
      .insert({
        owner_user_id: user.id,
        name: `${baseName}'s Workspace`,
        state: "setup_required",
        entitlement_type: "draft_only",
        operating_mode: "approval_required",
      })
      .select()
      .single();

    if (!wsErr && newWs) {
      return newWs as Workspace;
    }
  } catch (healError) {
    console.error("[requireWorkspace] Self-healing workspace provisioning failed:", healError);
  }

  throw new ForbiddenError("Workspace not found.");
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

// ─── Access mode & Entitlement checks ─────────────────────────────────────────

export function getAccessMode(
  workspace: Pick<Workspace, "entitlement_type"> & { access_mode?: AccessMode }
): AccessMode {
  if (workspace.access_mode) return workspace.access_mode;
  if (workspace.entitlement_type === "internal_beta") {
    return "private_beta";
  }
  return "commercial";
}

const ENTITLEMENT_LEVELS: Record<EntitlementType, number> = {
  inactive:         0,
  suspended:        0,
  expired:          0,
  draft_only:       1,
  internal_beta:    3,
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
 * Requires internal_beta, paid_trial, or paid_active.
 * draft_only, suspended, expired, and inactive cannot publish.
 */
export function canPublish(workspace: Pick<Workspace, "entitlement_type">): boolean {
  return (
    workspace.entitlement_type === "internal_beta" ||
    workspace.entitlement_type === "paid_trial" ||
    workspace.entitlement_type === "paid_active"
  );
}

/**
 * Checks whether Autopilot is permitted for this workspace.
 * Permitted for paid customers (paid_trial, paid_active) AND private beta (internal_beta)
 * when operating_mode is explicitly set to autopilot.
 */
export function canUseAutopilot(
  workspace: Pick<Workspace, "entitlement_type" | "operating_mode">
): boolean {
  return (
    canPublish(workspace) &&
    workspace.operating_mode === "autopilot"
  );
}

/**
 * Checks whether scheduling is permitted.
 * Same entitlement gate as publishing.
 */
export function canSchedule(workspace: Pick<Workspace, "entitlement_type">): boolean {
  return canPublish(workspace);
}

// ─── Capability Evaluation Layer (§7) ─────────────────────────────────────────

export interface CapabilityEvaluation {
  eligible: boolean;
  integrationReady: boolean;
  safetyReady: boolean;
  allowed: boolean;
  blockerCode?: "SUBSCRIPTION_REQUIRED" | "INTEGRATION_DISCONNECTED" | "SAFETY_PAUSED" | "RATE_LIMITED";
  blockerReason?: string;
}

/**
 * Evaluates publishing readiness across feature eligibility, integration, and safety gates.
 */
export function evaluatePublishCapability(
  workspace: Pick<Workspace, "entitlement_type" | "paused_at">,
  integrationStatus?: "connected" | "disconnected" | "expired" | "error" | null,
  isRateLimited: boolean = false
): CapabilityEvaluation {
  const eligible = canPublish(workspace);
  const integrationReady = integrationStatus === "connected";
  const safetyReady = !workspace.paused_at && !isRateLimited;

  if (!eligible) {
    return {
      eligible: false,
      integrationReady,
      safetyReady,
      allowed: false,
      blockerCode: "SUBSCRIPTION_REQUIRED",
      blockerReason: "Publishing requires an active trial, subscription, or authorized private beta access.",
    };
  }

  if (!integrationReady) {
    return {
      eligible: true,
      integrationReady: false,
      safetyReady,
      allowed: false,
      blockerCode: "INTEGRATION_DISCONNECTED",
      blockerReason: "LinkedIn account is not connected. Connect your LinkedIn profile to publish.",
    };
  }

  if (!safetyReady) {
    return {
      eligible: true,
      integrationReady: true,
      safetyReady: false,
      allowed: false,
      blockerCode: workspace.paused_at ? "SAFETY_PAUSED" : "RATE_LIMITED",
      blockerReason: workspace.paused_at
        ? "Agent is paused. Resume agent before publishing."
        : "Posting limit reached for today.",
    };
  }

  return {
    eligible: true,
    integrationReady: true,
    safetyReady: true,
    allowed: true,
  };
}

/**
 * Convenience wrapper: require workspace + assert can publish.
 * Throws AuthError, ForbiddenError, or EntitlementError as appropriate.
 */
export async function requirePublishingAccess(): Promise<Workspace> {
  const workspace = await requireWorkspace();
  if (!canPublish(workspace)) {
    throw new EntitlementError("active trial or subscription", workspace.entitlement_type);
  }
  if (workspace.paused_at) {
    throw new ForbiddenError("Agent is paused. Resume before publishing.");
  }
  return workspace;
}
