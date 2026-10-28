/**
 * Official LinkedIn OAuth and Integration Client.
 *
 * Implements BED-03 & docs/INTEGRATIONS_LINKEDIN.md:
 * - 3-legged OAuth code flow
 * - Stores encrypted tokens at rest (AES-256-GCM)
 * - Persists member URN non-secret identifier
 * - Never returns raw tokens to browser, logs, or MCP
 */

import { encryptToken } from "./crypto";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/db/workspace";
import type { IntegrationConnection } from "@/types/database";

export const LINKEDIN_API_VERSION = process.env.LINKEDIN_API_VERSION ?? "202410";
export const LINKEDIN_SCOPES = ["w_member_social", "openid", "profile", "email"];

export function getLinkedInAuthorizationUrl(state: string): string {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI ?? "http://localhost:3000/app/integrations/linkedin/callback";

  if (!clientId || clientId.includes("your-linkedin")) {
    throw new Error("LINKEDIN_CLIENT_ID is not configured in environment variables.");
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: LINKEDIN_SCOPES.join(" "),
  });

  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
}

export interface TokenExchangeResult {
  accessToken: string;
  expiresIn: number;
  memberUrn: string;
  name?: string;
}

export async function exchangeLinkedInCode(code: string): Promise<TokenExchangeResult> {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI ?? "http://localhost:3000/app/integrations/linkedin/callback";

  if (!clientId || !clientSecret) {
    throw new Error("LinkedIn credentials are not configured.");
  }

  // 1. Exchange code for access token
  const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    const errorText = await tokenRes.text();
    throw new Error(`LinkedIn token exchange failed (${tokenRes.status}): ${errorText.slice(0, 200)}`);
  }

  const tokenJson = (await tokenRes.json()) as { access_token: string; expires_in: number };
  const accessToken = tokenJson.access_token;
  const expiresIn = tokenJson.expires_in;

  // 2. Fetch UserInfo to get OpenID sub (member URN)
  let memberUrn = "urn:li:person:unknown";
  let name: string | undefined;

  try {
    const userRes = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (userRes.ok) {
      const userJson = (await userRes.json()) as { sub?: string; name?: string };
      if (userJson.sub) {
        memberUrn = `urn:li:person:${userJson.sub}`;
      }
      name = userJson.name;
    }
  } catch (err) {
    console.warn("[linkedin] Failed to fetch userinfo sub:", err);
  }

  return {
    accessToken,
    expiresIn,
    memberUrn,
    name,
  };
}

export async function saveLinkedInConnection(
  workspaceId: string,
  userId: string,
  data: TokenExchangeResult
): Promise<IntegrationConnection> {
  const encryptedRef = encryptToken(data.accessToken);
  const expiresAt = new Date(Date.now() + data.expiresIn * 1000).toISOString();
  const supabase = await createClient();

  const { data: connection, error } = await supabase
    .from("integration_connections")
    .upsert(
      {
        workspace_id: workspaceId,
        provider: "linkedin",
        external_account_id: data.memberUrn,
        encrypted_token_ref: encryptedRef,
        granted_scopes: LINKEDIN_SCOPES,
        status: "connected",
        expires_at: expiresAt,
        connected_at: new Date().toISOString(),
        metadata: {
          name: data.name,
          apiVersion: LINKEDIN_API_VERSION,
        },
      },
      { onConflict: "workspace_id,provider" }
    )
    .select()
    .single();

  if (error) {
    throw new Error(`[linkedin] Failed to save connection: ${error.message}`);
  }

  await logAuditEvent({
    workspaceId,
    actorType: "user",
    actorId: userId,
    action: "connect_integration",
    resourceType: "integration_connection",
    resourceId: connection.id,
    safeMetadata: {
      provider: "linkedin",
      memberUrn: data.memberUrn,
      apiVersion: LINKEDIN_API_VERSION,
    },
  });

  return connection as IntegrationConnection;
}

export async function disconnectLinkedIn(
  workspaceId: string,
  userId: string
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("integration_connections")
    .update({
      status: "disconnected",
      encrypted_token_ref: null,
      disconnected_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("provider", "linkedin");

  if (error) {
    throw new Error(`[linkedin] Failed to disconnect: ${error.message}`);
  }

  await logAuditEvent({
    workspaceId,
    actorType: "user",
    actorId: userId,
    action: "disconnect_integration",
    resourceType: "integration_connection",
    safeMetadata: { provider: "linkedin" },
  });
}
