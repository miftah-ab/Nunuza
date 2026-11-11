/**
 * LinkedIn Client & Publishing Unit Tests.
 *
 * Verifies:
 * - OAuth authorization URL generation with correct scopes (BED-03)
 * - Token encryption & decryption round-trip via AES-256-GCM
 * - publishPostToLinkedIn fail-closed behaviors:
 *   - Missing connection -> LINKEDIN_NOT_CONNECTED
 *   - Expired token -> LINKEDIN_AUTH_EXPIRED & marked expired in DB
 *   - Successful REST API post (201 Created) -> extracts x-restli-id
 *   - Auth failure (401/403) -> marks expired in DB & throws
 *   - Rate limited (429) -> throws retryable error
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getLinkedInAuthorizationUrl,
  publishPostToLinkedIn,
  LINKEDIN_SCOPES,
} from "./client";
import { encryptToken, decryptToken } from "./crypto";

describe("LinkedIn Client & Crypto Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LINKEDIN_CLIENT_ID = "test-client-id";
    process.env.LINKEDIN_CLIENT_SECRET = "test-client-secret";
    process.env.LINKEDIN_REDIRECT_URI = "http://localhost:3000/app/integrations/linkedin/callback";
    process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  describe("Token Crypto (AES-256-GCM)", () => {
    it("successfully encrypts and decrypts OAuth tokens", () => {
      const originalToken = "AQV_test_linkedin_access_token_super_secret_12345";
      const encryptedRef = encryptToken(originalToken);

      expect(encryptedRef).not.toBe(originalToken);
      expect(encryptedRef.split(":")).toHaveLength(3); // iv:tag:ciphertext

      const decrypted = decryptToken(encryptedRef);
      expect(decrypted).toBe(originalToken);
    });

    it("rejects tampered encrypted token references", () => {
      const originalToken = "AQV_test_token";
      const encryptedRef = encryptToken(originalToken);
      const [iv, tag, ciphertext] = encryptedRef.split(":");

      // Tamper ciphertext
      const tamperedCiphertext = ciphertext.slice(0, -2) + "ff";
      const tamperedRef = `${iv}:${tag}:${tamperedCiphertext}`;

      expect(() => decryptToken(tamperedRef)).toThrow();
    });
  });

  describe("OAuth URL Generation", () => {
    it("generates correct authorization URL with required scopes", () => {
      const state = "anti_csrf_state_123";
      const authUrlStr = getLinkedInAuthorizationUrl(state);
      const url = new URL(authUrlStr);

      expect(url.origin).toBe("https://www.linkedin.com");
      expect(url.pathname).toBe("/oauth/v2/authorization");
      expect(url.searchParams.get("client_id")).toBe("test-client-id");
      expect(url.searchParams.get("redirect_uri")).toBe(
        "http://localhost:3000/app/integrations/linkedin/callback"
      );
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("state")).toBe(state);

      const scopes = url.searchParams.get("scope")?.split(" ");
      expect(scopes).toContain("w_member_social");
      expect(scopes).toContain("openid");
      expect(scopes).toContain("profile");
      expect(scopes).toContain("email");
    });
  });

  describe("publishPostToLinkedIn", () => {
    const validMemberUrn = "urn:li:person:testMember123";
    const sampleToken = "AQV_valid_access_token_linkedin";
    let validEncryptedRef: string;

    beforeEach(() => {
      validEncryptedRef = encryptToken(sampleToken);
    });

    it("fails closed when no connection exists in workspace", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: null,
                }),
              }),
            }),
          }),
        }),
      };

      await expect(
        publishPostToLinkedIn({
          workspaceId: "ws-1",
          text: "Hello LinkedIn!",
          supabaseOverride: mockSupabase as any,
        })
      ).rejects.toThrow("LINKEDIN_NOT_CONNECTED");
    });

    it("fails closed when connection is marked expired", async () => {
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: "conn-1",
                    workspace_id: "ws-1",
                    provider: "linkedin",
                    status: "connected",
                    encrypted_token_ref: validEncryptedRef,
                    external_account_id: validMemberUrn,
                    expires_at: new Date(Date.now() - 3600000).toISOString(), // 1 hr ago
                  },
                  error: null,
                }),
              }),
            }),
          }),
          update: updateMock,
        }),
      };

      await expect(
        publishPostToLinkedIn({
          workspaceId: "ws-1",
          text: "Hello LinkedIn!",
          supabaseOverride: mockSupabase as any,
        })
      ).rejects.toThrow("LINKEDIN_AUTH_EXPIRED");

      expect(updateMock).toHaveBeenCalledWith({ status: "expired" });
    });

    it("publishes successfully and extracts post URN on HTTP 201 Created", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: "conn-1",
                    workspace_id: "ws-1",
                    provider: "linkedin",
                    status: "connected",
                    encrypted_token_ref: validEncryptedRef,
                    external_account_id: validMemberUrn,
                    expires_at: new Date(Date.now() + 86400000).toISOString(),
                    metadata: { apiVersion: "202410" },
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      };

      const expectedUrn = "urn:li:share:9876543210";
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({
          "x-restli-id": expectedUrn,
        }),
        json: async () => ({ id: expectedUrn }),
        text: async () => JSON.stringify({ id: expectedUrn }),
      } as any);

      const result = await publishPostToLinkedIn({
        workspaceId: "ws-1",
        text: "Automated test post on LinkedIn",
        supabaseOverride: mockSupabase as any,
      });

      expect(result.linkedinPostId).toBe(expectedUrn);
      expect(result.publishedAt).toBeDefined();

      // Verify request payload & headers
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.linkedin.com/rest/posts",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${sampleToken}`,
            "LinkedIn-Version": "202608",
            "X-Restli-Protocol-Version": "2.0.0",
            "Content-Type": "application/json",
          }),
        })
      );

      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
      expect(sentBody.author).toBe(validMemberUrn);
      expect(sentBody.commentary).toBe("Automated test post on LinkedIn");
      expect(sentBody.visibility).toBe("PUBLIC");
    });

    it("handles 401/403 authorization failures by updating connection status to expired", async () => {
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: "conn-1",
                    workspace_id: "ws-1",
                    provider: "linkedin",
                    status: "connected",
                    encrypted_token_ref: validEncryptedRef,
                    external_account_id: validMemberUrn,
                    expires_at: new Date(Date.now() + 86400000).toISOString(),
                  },
                  error: null,
                }),
              }),
            }),
          }),
          update: updateMock,
        }),
      };

      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => "Unauthorized: Token revoked",
      } as any);

      await expect(
        publishPostToLinkedIn({
          workspaceId: "ws-1",
          text: "Test post",
          supabaseOverride: mockSupabase as any,
        })
      ).rejects.toThrow("LINKEDIN_AUTH_FAILED (401)");

      expect(updateMock).toHaveBeenCalledWith({ status: "expired" });
    });

    it("handles 429 rate limit errors as retryable", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: "conn-1",
                    workspace_id: "ws-1",
                    provider: "linkedin",
                    status: "connected",
                    encrypted_token_ref: validEncryptedRef,
                    external_account_id: validMemberUrn,
                    expires_at: new Date(Date.now() + 86400000).toISOString(),
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      };

      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => "Too Many Requests",
      } as any);

      await expect(
        publishPostToLinkedIn({
          workspaceId: "ws-1",
          text: "Test post",
          supabaseOverride: mockSupabase as any,
        })
      ).rejects.toThrow("LINKEDIN_RATE_LIMITED (429)");
    });
  });
});
