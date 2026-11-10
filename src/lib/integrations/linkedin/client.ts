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
import { createServiceClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/db/workspace";
import type { IntegrationConnection } from "@/types/database";

export const LINKEDIN_API_VERSION = "202610";
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
  grantedScopes: string[];
  name?: string;
}

function parseGrantedScopes(value: string | undefined): string[] {
  if (!value) return [];
  let decoded = value;
  try {
    decoded = decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    // Keep the provider's original scope string; parsing below remains safe.
  }
  return decoded.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean);
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

  const tokenJson = (await tokenRes.json()) as { access_token: string; expires_in: number; scope?: string };
  const accessToken = tokenJson.access_token;
  const expiresIn = tokenJson.expires_in;

  // Persist the actual grant, not merely the scopes requested by Nunuza.
  // LinkedIn documents scope on the token response; if absent, verify using
  // its official token-introspection endpoint.
  let grantedScopes = parseGrantedScopes(tokenJson.scope);
  if (grantedScopes.length === 0) {
    const introspectionRes = await fetch("https://www.linkedin.com/oauth/v2/introspectToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        token: accessToken,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!introspectionRes.ok) {
      throw new Error("LinkedIn token scope verification failed. The connection was not saved.");
    }
    const introspection = await introspectionRes.json() as { active?: boolean; scope?: string };
    if (introspection.active !== true) {
      throw new Error("LinkedIn returned an inactive access token. The connection was not saved.");
    }
    grantedScopes = parseGrantedScopes(introspection.scope);
  }
  if (!grantedScopes.includes("w_member_social")) {
    throw new Error("LinkedIn did not grant w_member_social. Reconnect after enabling the Share on LinkedIn product.");
  }

  // 2. Fetch UserInfo to get OpenID sub (member URN)
  let memberUrn: string | null = null;
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

  if (!memberUrn) {
    throw new Error("LinkedIn did not return a valid member identifier. The connection was not saved.");
  }

  return {
    accessToken,
    expiresIn,
    memberUrn,
    grantedScopes,
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
  const supabase = createServiceClient();

  const { data: connection, error } = await supabase
    .from("integration_connections")
    .upsert(
      {
        workspace_id: workspaceId,
        provider: "linkedin",
        external_account_id: data.memberUrn,
        encrypted_token_ref: encryptedRef,
        granted_scopes: data.grantedScopes,
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
  const supabase = createServiceClient();

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

export type LinkedInPublishErrorKind =
  | "not_connected" // no usable connection: terminal, nothing was sent
  | "auth" // token rejected: terminal, nothing was published
  | "rate_limited" // HTTP 429: definitively not published, safe to retry later
  | "rejected" // other 4xx: definitively not published, terminal
  | "ambiguous"; // request may or may not have created a post: NEVER retry blindly

/**
 * Typed publish failure. Callers must branch on `kind`, never on message text.
 *
 * "ambiguous" means LinkedIn may have created the post even though we did not get
 * a trustworthy confirmation (network error, timeout, 5xx, or a success response
 * without a post ID). It must be reconciled, not retried.
 */
export class LinkedInPublishError extends Error {
  readonly kind: LinkedInPublishErrorKind;
  constructor(kind: LinkedInPublishErrorKind, message: string) {
    super(message);
    this.name = "LinkedInPublishError";
    this.kind = kind;
  }
}

/** Upper bound for the create-post request. After this the outcome is unknown. */
export const LINKEDIN_PUBLISH_TIMEOUT_MS = 20_000;

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
  const supabase = options.supabaseOverride || createServiceClient();

  // 1. Fetch active LinkedIn connection
  const { data: connection, error } = await supabase
    .from("integration_connections")
    .select("*")
    .eq("workspace_id", options.workspaceId)
    .eq("provider", "linkedin")
    .maybeSingle();

  if (error || !connection) {
    throw new LinkedInPublishError(
      "not_connected",
      "LINKEDIN_NOT_CONNECTED: LinkedIn is not connected for this workspace. Please connect in Workspace Integrations."
    );
  }

  if (!Array.isArray(connection.granted_scopes) || !connection.granted_scopes.includes("w_member_social")) {
    throw new LinkedInPublishError(
      "auth",
      "LINKEDIN_SCOPE_MISSING: The connected account lacks w_member_social permission required to publish."
    );
  }

  if (connection.status !== "connected" || !connection.encrypted_token_ref) {
    throw new LinkedInPublishError(
      "not_connected",
      `LINKEDIN_NOT_CONNECTED: LinkedIn connection is currently '${connection.status}'. Please reconnect in Workspace Integrations.`
    );
  }

  // 2. Check token expiration
  if (connection.expires_at && new Date(connection.expires_at).getTime() < Date.now()) {
    await supabase
      .from("integration_connections")
      .update({ status: "expired" })
      .eq("id", connection.id);

    throw new LinkedInPublishError(
      "auth",
      "LINKEDIN_AUTH_EXPIRED: LinkedIn OAuth access token has expired. Please reconnect in Integrations."
    );
  }

  // 3. Decrypt access token securely in-memory only (BED-03)
  const accessToken = decryptToken(connection.encrypted_token_ref);
  const memberUrn = connection.external_account_id;
  // Always use the centralized constant — ignore stale apiVersion in connection metadata
  const apiVersion = LINKEDIN_API_VERSION;

  if (!memberUrn || !memberUrn.startsWith("urn:li:person:")) {
    throw new LinkedInPublishError(
      "not_connected",
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

  let response: Response;
  try {
    response = await fetch("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "LinkedIn-Version": apiVersion,
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(LINKEDIN_PUBLISH_TIMEOUT_MS),
    });
  } catch {
    // Network failure or timeout AFTER the request may have been delivered.
    // We cannot know whether LinkedIn created the post.
    throw new LinkedInPublishError(
      "ambiguous",
      "LINKEDIN_AMBIGUOUS_PUBLICATION: The connection to LinkedIn failed or timed out after the post was sent. The post may or may not be live."
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    const status = response.status;

    if (status === 401 || status === 403) {
      await supabase
        .from("integration_connections")
        .update({ status: "expired" })
        .eq("id", connection.id);

      throw new LinkedInPublishError(
        "auth",
        `LINKEDIN_AUTH_FAILED (${status}): LinkedIn authorization expired or lacks w_member_social scope. Reconnect required.`
      );
    }

    if (status === 429) {
      throw new LinkedInPublishError(
        "rate_limited",
        `LINKEDIN_RATE_LIMITED (429): LinkedIn API rate limit exceeded. Retryable.`
      );
    }

    if (status >= 500) {
      // A server error does not prove the post was not created.
      throw new LinkedInPublishError(
        "ambiguous",
        `LINKEDIN_AMBIGUOUS_PUBLICATION (${status}): LinkedIn returned a server error. The post may or may not be live.`
      );
    }

    throw new LinkedInPublishError(
      "rejected",
      `LINKEDIN_API_ERROR (${status}): ${errorText.slice(0, 200)}`
    );
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

  // Only accept a real LinkedIn URN as confirmation evidence.
  if (postId && !postId.startsWith("urn:li:")) {
    postId = null;
  }

  if (!postId) {
    // HTTP success without a usable post ID. The post was probably created, but we
    // have no trustworthy identifier. Never invent one and never retry blindly.
    throw new LinkedInPublishError(
      "ambiguous",
      "LINKEDIN_AMBIGUOUS_PUBLICATION: LinkedIn accepted the request but returned no post ID, so publication could not be confirmed."
    );
  }

  return {
    linkedinPostId: postId,
    publishedAt: new Date().toISOString(),
  };
}
