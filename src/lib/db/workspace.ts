/**
 * Workspace data access — workspace queries and workspace service helpers.
 *
 * All functions use pre-verified workspace ownership.
 * Use requireWorkspace() from lib/auth/workspace.ts before calling these.
 */

import { createClient } from "@/lib/supabase/server";
import type { Workspace, VoiceProfile, ContentStrategy } from "@/types/database";

// ─── Workspace ────────────────────────────────────────────────────────────────

/** Fetch the full workspace row for the authenticated user. */
export async function getWorkspace(userId: string): Promise<Workspace | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("workspaces")
    .select("*")
    .eq("owner_user_id", userId)
    .single();

  if (error?.code === "PGRST116") return null;
  if (error) throw new Error(`[db] getWorkspace: ${error.message}`);
  return data as Workspace;
}

// ─── Onboarding setup ──────────────────────────────────────────────────────────

/**
 * Marks the workspace setup as complete by transitioning from
 * setup_required → active_approval_required.
 *
 * Only applies when current state is setup_required.
 * Autopilot is never set here — it requires a separate gate.
 */
export async function markSetupComplete(workspaceId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("workspaces")
    .update({ state: "active_approval_required" })
    .eq("id", workspaceId)
    .eq("state", "setup_required"); // only transition from setup_required

  if (error) throw new Error(`[db] markSetupComplete: ${error.message}`);
}

// ─── Voice profile ────────────────────────────────────────────────────────────

export interface UpsertVoiceProfileInput {
  tone?: string;
  sentence_length?: string;
  formality?: string;
  phrases_use?: string[];
  phrases_avoid?: string[];
  sample_text?: string;
  exclusions?: string[];
}

export async function getVoiceProfile(workspaceId: string): Promise<VoiceProfile | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("voice_profiles")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) throw new Error(`[db] getVoiceProfile: ${error.message}`);
  return data as VoiceProfile | null;
}

export async function upsertVoiceProfile(
  workspaceId: string,
  input: UpsertVoiceProfileInput
): Promise<VoiceProfile> {
  const supabase = await createClient();

  const existing = await getVoiceProfile(workspaceId);

  const { data, error } = await supabase
    .from("voice_profiles")
    .upsert({
      workspace_id: workspaceId,
      ...input,
      version: (existing?.version ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`[db] upsertVoiceProfile: ${error.message}`);
  return data as VoiceProfile;
}

// ─── Content strategy ─────────────────────────────────────────────────────────

export interface UpsertStrategyInput {
  audience?: Record<string, unknown>;
  goals?: string[];
  pillars?: unknown[];
  cadence_per_week?: number;
  preferred_days?: number[];
  preferred_time?: string;
  timezone?: string;
  exclusions?: string[];
  cta_preferences?: string[];
}

export async function getContentStrategy(workspaceId: string): Promise<ContentStrategy | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("content_strategies")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) throw new Error(`[db] getContentStrategy: ${error.message}`);
  return data as ContentStrategy | null;
}

export async function upsertContentStrategy(
  workspaceId: string,
  input: UpsertStrategyInput
): Promise<ContentStrategy> {
  const supabase = await createClient();

  const existing = await getContentStrategy(workspaceId);

  const { data, error } = await supabase
    .from("content_strategies")
    .upsert({
      workspace_id: workspaceId,
      ...input,
      version: (existing?.version ?? 0) + 1,
    })
    .select()
    .single();

  if (error) throw new Error(`[db] upsertContentStrategy: ${error.message}`);
  return data as ContentStrategy;
}

// ─── Audit logging ────────────────────────────────────────────────────────────

export interface LogAuditEventInput {
  workspaceId: string;
  actorType: "user" | "system" | "admin" | "telegram" | "mcp";
  actorId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  safeMetadata?: Record<string, unknown>;
}

/**
 * Appends an audit event row. Non-throwing — audit failures must not
 * block the primary operation. Errors are console-logged only.
 */
export async function logAuditEvent(input: LogAuditEventInput): Promise<void> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("audit_events").insert({
      workspace_id: input.workspaceId,
      actor_type: input.actorType,
      actor_id: input.actorId ?? null,
      action: input.action,
      resource_type: input.resourceType,
      resource_id: input.resourceId ?? null,
      safe_metadata: input.safeMetadata ?? {},
    });

    if (error) {
      console.error(`[audit] logAuditEvent failed: ${error.message}`);
    }
  } catch (e) {
    console.error("[audit] logAuditEvent threw:", e);
  }
}
