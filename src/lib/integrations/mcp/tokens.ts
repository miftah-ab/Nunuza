/**
 * Remote MCP Credential & Token Management.
 *
 * Implements high-entropy, workspace-scoped API keys (mcp_credentials table).
 *
 * Rules (BED-11 & Spec §11):
 * - Exactly one active credential set per workspace (revoked_at IS NULL).
 * - High-entropy keys prefixed with `nunuza_mcp_`.
 * - Stored as SHA-256 hash; raw key shown only once at creation.
 * - Key rotation revokes previous credential immediately.
 * - Credentials never expose service-role secrets.
 */

import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase/server";

export interface McpTokenRecord {
  id: string;
  workspaceId: string;
  userId: string;
  scopes: string[];
  lastUsedAt?: string | null;
  createdAt: string;
}

export interface GeneratedMcpToken {
  id: string;
  rawToken: string;
  createdAt: string;
}

/**
 * Generates a new MCP API key for a workspace.
 * Revokes any currently active credentials for the workspace (BED-11).
 */
export async function generateMcpToken(
  workspaceId: string,
  userId: string,
  scopes: string[] = ["read", "write"],
  supabaseOverride?: any
): Promise<GeneratedMcpToken> {
  const supabase = supabaseOverride || createServiceClient();

  // 1. Generate high-entropy token: nunuza_mcp_<32 hex chars>
  const randomHex = crypto.randomBytes(24).toString("hex");
  const rawToken = `nunuza_mcp_${randomHex}`;
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  // 2. Revoke any previous active credentials for this workspace
  await supabase
    .from("mcp_credentials")
    .update({ revoked_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null);

  // 3. Insert new credential record
  const { data, error } = await supabase
    .from("mcp_credentials")
    .insert({
      workspace_id: workspaceId,
      user_id: userId,
      token_hash: tokenHash,
      scopes,
      created_at: new Date().toISOString(),
    })
    .select("id, created_at")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create MCP credential: ${error?.message || "Unknown error"}`);
  }

  // 4. Log audit event
  await supabase.from("audit_events").insert({
    workspace_id: workspaceId,
    actor_type: "user",
    actor_id: userId,
    action: "mcp_token_generated",
    resource_type: "mcp_credential",
    resource_id: data.id,
    safe_metadata: { scopes },
  });

  return {
    id: data.id,
    rawToken,
    createdAt: data.created_at,
  };
}

/**
 * Verifies an incoming raw MCP Bearer token and returns the workspace context.
 * Updates last_used_at timestamp on successful verification.
 */
export async function verifyMcpToken(
  rawToken: string,
  supabaseOverride?: any
): Promise<McpTokenRecord | null> {
  if (!rawToken || !rawToken.startsWith("nunuza_mcp_")) {
    return null;
  }

  const supabase = supabaseOverride || createServiceClient();
  const tokenHash = crypto.createHash("sha256").update(rawToken.trim()).digest("hex");

  const { data, error } = await supabase
    .from("mcp_credentials")
    .select("id, workspace_id, user_id, scopes, expires_at, revoked_at, last_used_at, created_at")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  // Check expiration if set
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    return null;
  }

  // Update last_used_at non-blockingly
  supabase
    .from("mcp_credentials")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => {});

  return {
    id: data.id,
    workspaceId: data.workspace_id,
    userId: data.user_id,
    scopes: data.scopes || ["read", "write"],
    lastUsedAt: data.last_used_at,
    createdAt: data.created_at,
  };
}

/**
 * Revokes the active MCP credential for a workspace.
 */
export async function revokeMcpToken(
  workspaceId: string,
  userId?: string,
  supabaseOverride?: any
): Promise<boolean> {
  const supabase = supabaseOverride || createServiceClient();

  const { error } = await supabase
    .from("mcp_credentials")
    .update({ revoked_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null);

  if (!error) {
    await supabase.from("audit_events").insert({
      workspace_id: workspaceId,
      actor_type: "user",
      actor_id: userId ?? null,
      action: "mcp_token_revoked",
      resource_type: "mcp_credential",
      safe_metadata: {},
    });
    return true;
  }
  return false;
}

/**
 * Returns metadata about the active MCP credential for a workspace (without the secret).
 */
export async function getMcpCredentialStatus(
  workspaceId: string,
  supabaseOverride?: any
): Promise<{
  active: boolean;
  id?: string;
  createdAt?: string;
  lastUsedAt?: string | null;
  scopes?: string[];
}> {
  const supabase = supabaseOverride || createServiceClient();

  const { data, error } = await supabase
    .from("mcp_credentials")
    .select("id, created_at, last_used_at, scopes")
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !data) {
    return { active: false };
  }

  return {
    active: true,
    id: data.id,
    createdAt: data.created_at,
    lastUsedAt: data.last_used_at,
    scopes: data.scopes,
  };
}
