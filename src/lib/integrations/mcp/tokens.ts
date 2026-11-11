/**
 * Remote MCP Credential & Token Management.
 *
 * Implements high-entropy, workspace-scoped API keys (mcp_credentials table).
 *
 * Rules (BED-11 & Spec §11):
 * - Exactly one active credential set per workspace (revoked_at IS NULL).
 * - High-entropy keys prefixed with \`nunuza_mcp_\`.
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
  expiresAt?: number;
}

export interface GeneratedMcpToken {
  id: string;
  rawToken: string;
  createdAt: string;
}

export async function generateMcpToken(
  workspaceId: string,
  userId: string,
  scopes: string[] = ["read", "write"],
  supabaseOverride?: any
): Promise<GeneratedMcpToken> {
  const supabase = supabaseOverride || createServiceClient();
  const randomHex = crypto.randomBytes(24).toString("hex");
  const rawToken = \`nunuza_mcp_\${randomHex}\`;
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const { error: revokeError } = await supabase
    .from("mcp_credentials")
    .update({ revoked_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null);

  if (revokeError) {
    throw new Error(\`Failed to revoke previous MCP credential: \${revokeError.message}\`);
  }

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
    throw new Error(\`Failed to create MCP credential: \${error?.message || "Unknown error"}\`);
  }

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

export async function verifyMcpToken(
  rawToken: string,
  supabaseOverride?: any
): Promise<McpTokenRecord | null> {
  if (!rawToken || !rawToken.startsWith("nunuza_mcp_")) return null;

  const supabase = supabaseOverride || createServiceClient();
  const tokenHash = crypto.createHash("sha256").update(rawToken.trim()).digest("hex");

  const { data, error } = await supabase
    .from("mcp_credentials")
    .select("id, workspace_id, user_id, scopes, expires_at, revoked_at, last_used_at, created_at")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !data) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return null;

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

  if (error || !data) return { active: false };

  return {
    active: true,
    id: data.id,
    createdAt: data.created_at,
    lastUsedAt: data.last_used_at,
    scopes: data.scopes,
  };
}

/**
 * Verify a Supabase OAuth access token issued to a registered MCP client.
 * OAuth tokens are user-scoped: workspace identity is derived from the verified
 * Supabase subject, never from client-supplied workspace identifiers.
 */
export async function verifyMcpOAuthToken(
  rawToken: string,
  supabaseOverride?: any
): Promise<McpTokenRecord | null> {
  if (!rawToken || rawToken.length > 8192 || !rawToken.includes(".")) return null;

  const supabase = supabaseOverride || createServiceClient();
  const { data, error } = await supabase.auth.getClaims(rawToken);
  if (error || !data?.claims) return null;

  const claims = data.claims as Record<string, unknown>;
  const userId = claims.sub;
  const clientId = claims.client_id;
  const expiresAt = Number(claims.exp);
  const expectedIssuer = \`\${(process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "")}/auth/v1\`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const expectedAudience = process.env.MCP_RESOURCE_URL
    || (appUrl ? new URL("/api/mcp", appUrl).toString() : null);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];

  if (
    typeof userId !== "string" ||
    typeof clientId !== "string" ||
    clientId.length === 0 ||
    claims.iss !== expectedIssuer ||
    !expectedAudience ||
    !audiences.includes(expectedAudience) ||
    !Number.isFinite(expiresAt) ||
    expiresAt * 1000 <= Date.now()
  ) {
    return null;
  }

  const { data: authUser, error: authUserError } = await supabase.auth.getUser(rawToken);
  if (authUserError || authUser?.user?.id !== userId) return null;

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_user_id", userId)
    .maybeSingle();

  if (workspaceError || !workspace?.id) return null;

  const requestedScopes = claims.mcp_scopes;
  const scopes = Array.isArray(requestedScopes)
    ? requestedScopes.filter((scope): scope is string => scope === "read" || scope === "write")
    : ["read", "write"];

  if (scopes.length === 0) return null;

  return {
    id: \`oauth:\${clientId}\`,
    workspaceId: workspace.id,
    userId,
    scopes,
    lastUsedAt: null,
    createdAt: new Date(Number(claims.iat || Date.now() / 1000) * 1000).toISOString(),
    expiresAt,
  };
}
