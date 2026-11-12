import { describe, expect, it } from "vitest";
import {
  assertCanCreateMemberComments,
  assertCanReadMemberComments,
  getLinkedInEngagementCapabilities,
  LINKEDIN_MEMBER_COMMENT_READ_SCOPE,
  LINKEDIN_MEMBER_COMMENT_WRITE_SCOPE,
} from "./engagement-permissions";

describe("LinkedIn engagement permissions", () => {
  it("does not infer comment access from w_member_social", () => {
    expect(getLinkedInEngagementCapabilities(["w_member_social"])).toEqual({
      canReadMemberComments: false,
      canCreateMemberComments: false,
    });
    expect(() => assertCanReadMemberComments(["w_member_social"])).toThrow(/READ_UNAVAILABLE/);
    expect(() => assertCanCreateMemberComments(["w_member_social"])).toThrow(/WRITE_UNAVAILABLE/);
  });

  it("enables only the capabilities actually granted", () => {
    expect(getLinkedInEngagementCapabilities([LINKEDIN_MEMBER_COMMENT_READ_SCOPE])).toEqual({
      canReadMemberComments: true,
      canCreateMemberComments: false,
    });
    expect(getLinkedInEngagementCapabilities([LINKEDIN_MEMBER_COMMENT_WRITE_SCOPE])).toEqual({
      canReadMemberComments: false,
      canCreateMemberComments: true,
    });
  });

  it("allows both capabilities when both feed scopes are granted", () => {
    const scopes = [LINKEDIN_MEMBER_COMMENT_READ_SCOPE, LINKEDIN_MEMBER_COMMENT_WRITE_SCOPE];
    expect(() => assertCanReadMemberComments(scopes)).not.toThrow();
    expect(() => assertCanCreateMemberComments(scopes)).not.toThrow();
  });
});
