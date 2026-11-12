/**
 * LinkedIn member-comment permissions are distinct from the self-serve
 * Share on LinkedIn scope. Never infer these capabilities from product quotas.
 */
export const LINKEDIN_MEMBER_COMMENT_READ_SCOPE = "r_member_social_feed";
export const LINKEDIN_MEMBER_COMMENT_WRITE_SCOPE = "w_member_social_feed";

export interface LinkedInEngagementCapabilities {
  canReadMemberComments: boolean;
  canCreateMemberComments: boolean;
}

/** Derive capabilities only from the scopes actually granted to this connection. */
export function getLinkedInEngagementCapabilities(
  grantedScopes: readonly string[] | null | undefined
): LinkedInEngagementCapabilities {
  const scopes = new Set(grantedScopes ?? []);
  return {
    canReadMemberComments: scopes.has(LINKEDIN_MEMBER_COMMENT_READ_SCOPE),
    canCreateMemberComments: scopes.has(LINKEDIN_MEMBER_COMMENT_WRITE_SCOPE),
  };
}

export function assertCanReadMemberComments(
  grantedScopes: readonly string[] | null | undefined
): void {
  if (!getLinkedInEngagementCapabilities(grantedScopes).canReadMemberComments) {
    throw new Error("LINKEDIN_MEMBER_COMMENT_READ_UNAVAILABLE: LinkedIn has not granted member comment read access to this connection.");
  }
}

export function assertCanCreateMemberComments(
  grantedScopes: readonly string[] | null | undefined
): void {
  if (!getLinkedInEngagementCapabilities(grantedScopes).canCreateMemberComments) {
    throw new Error("LINKEDIN_MEMBER_COMMENT_WRITE_UNAVAILABLE: LinkedIn has not granted member comment write access to this connection.");
  }
}
