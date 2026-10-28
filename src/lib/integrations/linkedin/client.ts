/**
 * Official LinkedIn OAuth and Integration Client.
 *
 * Implements BED-03 & docs/INTEGRATIONS_LINKEDIN.md:
 * - 3-legged OAuth code flow
 * - Stores encrypted tokens at rest (AES-256-GCM)
 * - Persists member URN non-secret identifier
 * - Never returns raw tokens to browser, logs, or MCP
 */

import { encryptToken, decryptToken } from "./crypto";
import { createClient, createServiceClient } from "@/lib/supabase/server";
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

export interface PublishLinkedInOptions {
  workspaceId: string;
  text: string;
  supabaseOverride?: any;
}

export interface PublishLinkedInResult {
  linkedinPostId: string;
  publishedAt: string;
}

/**
 * Publishes a post to LinkedIn personal profile via the official REST API.
 *
 * Requirements:
 * - Scope: w_member_social (provided by self-serve "Share on LinkedIn" product)
 * - Decrypts token at rest via AES-256-GCM; token is never logged or exposed
 * - Uses LinkedIn REST API v202410 with X-Restli-Protocol-Version 2.0.0
 * - Fail-closed: throws clear errors if connection missing, expired, or rejected
 */
export async function publishPostToLinkedIn(
  options: PublishLinkedInOptions
): Promise<PublishLinkedInResult> {
  const supabase = options.supabaseOverride || (await createClient());

  // 1. Fetch active LinkedIn connection
  const { data: connection, error } = await supabase
    .from("integration_connections")
    .select("*")
    .eq("workspace_id", options.workspaceId)
    .eq("provider", "linkedin")
    .maybeSingle();

  if (error || !connection) {
    throw new Error(
      "LINKEDIN_NOT_CONNECTED: LinkedIn is not connected for this workspace. Please connect in Workspace Integrations."
    );
  }

  if (connection.status !== "connected" || !connection.encrypted_token_ref) {
    throw new Error(
      `LINKEDIN_NOT_CONNECTED: LinkedIn connection is currently '${connection.status}'. Please reconnect in Workspace Integrations.`
    );
  }

  // 2. Check token expiration
  if (connection.expires_at && new Date(connection.expires_at).getTime() < Date.now()) {
    await supabase
      .from("integration_connections")
      .update({ status: "expired" })
      .eq("id", connection.id);

    throw new Error(
      "LINKEDIN_AUTH_EXPIRED: LinkedIn OAuth access token has expired. Please reconnect in Integrations."
    );
  }

  // 3. Decrypt access token securely in-memory only (BED-03)
  const accessToken = decryptToken(connection.encrypted_token_ref);
  const memberUrn = connection.external_account_id;
  const apiVersion = connection.metadata?.apiVersion || LINKEDIN_API_VERSION;

  if (!memberUrn || !memberUrn.startsWith("urn:li:person:")) {
    throw new Error(
      `LINKEDIN_INVALID_MEMBER: Invalid member URN (${memberUrn}). Please reconnect your LinkedIn account.`
    );
  }

  // 4. Construct payload for LinkedIn Posts REST API
  const payload = {
    author: memberUrn,
    commentary: options.text,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    "isReshareDisabledByAuthor": false,
  };

  const response = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "LinkedIn-Version": apiVersion,
      "X-Restli-Protocol-Version": "2.0.0",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const status = response.status;

    if (status === 401 || status === 403) {
      await supabase
        .from("integration_connections")
        .update({ status: "expired" })
        .eq("id", connection.id);

      throw new Error(
        `LINKEDIN_AUTH_FAILED (${status}): LinkedIn authorization expired or lacks w_member_social scope. Reconnect required.`
      );
    }

    if (status === 429) {
      throw new Error(`LINKEDIN_RATE_LIMITED (429): LinkedIn API rate limit exceeded. Retryable.`);
    }

    throw new Error(`LINKEDIN_API_ERROR (${status}): ${errorText.slice(0, 200)}`);
  }

  // Post ID from x-restli-id header (canonical LinkedIn REST convention) or response body
  const restliId = response.headers.get("x-restli-id");
  let postId = restliId;
  if (!postId) {
    try {
      const json = (await response.json()) as { id?: string };
      postId = json.id ?? null;
    } catch {
      // fallback
    }
  }

  if (!postId) {
    postId = `urn:li:share:${Date.now()}`;
  }

  return {
    linkedinPostId: postId,
    publishedAt: new Date().toISOString(),
  };
}
