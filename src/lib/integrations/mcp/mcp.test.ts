import { describe, it, expect, beforeEach } from "vitest";
import { generateMcpToken, verifyMcpToken, revokeMcpToken, getMcpCredentialStatus } from "./tokens";
import { MCP_TOOLS, executeMcpTool } from "./tools";
import crypto from "crypto";

class MockMcpDb {
  mcpCredentials: any[] = [];
  workspaces: any[] = [
    {
      id: "ws-aaa",
      owner_user_id: "user-aaa",
      name: "Founder Workspace A",
      entitlement_type: "draft_only",
      status: "active",
      created_at: new Date().toISOString(),
    },
    {
      id: "ws-bbb",
      owner_user_id: "user-bbb",
      name: "Founder Workspace B (Beta)",
      entitlement_type: "publishing_beta",
      status: "active",
      created_at: new Date().toISOString(),
    },
  ];
  contentPosts: any[] = [
    {
      id: "post-1",
      workspace_id: "ws-aaa",
      text: "Draft A content",
      hook: "Hook A",
      status: "draft",
      created_at: new Date().toISOString(),
    },
    {
      id: "post-2",
      workspace_id: "ws-bbb",
      text: "Draft B content (approved)",
      hook: "Hook B",
      status: "approved",
      approved_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    },
  ];
  contentPostVersions: any[] = [];
  auditEvents: any[] = [];
  usageCounters: any[] = [];

  createClient() {
    const db = this;
    return {
      from(table: string) {
        return {
          select(fields = "*", options?: any) {
            let data: any[] = [];
            if (table === "mcp_credentials") data = [...db.mcpCredentials];
            else if (table === "workspaces") data = [...db.workspaces];
            else if (table === "content_posts") data = [...db.contentPosts];
            else if (table === "usage_counters") data = [...db.usageCounters];
            else if (table === "audit_events") data = [...db.auditEvents];

            let filtered = data;
            const chain = {
              eq(col: string, val: any) {
                filtered = filtered.filter((r) => r[col] === val);
                return chain;
              },
              is(col: string, val: any) {
                filtered = filtered.filter((r) => (val === null ? r[col] === null || r[col] === undefined : r[col] === val));
                return chain;
              },
              gte(col: string, val: any) {
                filtered = filtered.filter((r) => r[col] >= val);
                return chain;
              },
              lte(col: string, val: any) {
                filtered = filtered.filter((r) => r[col] <= val);
                return chain;
              },
              order(col: string, opts?: any) {
                return chain;
              },
              limit(n: number) {
                filtered = filtered.slice(0, n);
                return chain;
              },
              async single() {
                if (options?.count === "exact" && options?.head) {
                  return { count: filtered.length, data: null, error: null };
                }
                const item = filtered[0];
                return item ? { data: item, error: null } : { data: null, error: new Error("Not found") };
              },
              async maybeSingle() {
                const item = filtered[0];
                return { data: item || null, error: null };
              },
              then(resolve: any) {
                if (options?.count === "exact" && options?.head) {
                  return resolve({ count: filtered.length, data: null, error: null });
                }
                return resolve({ data: filtered, count: filtered.length, error: null });
              },
            };
            return chain;
          },
          insert(rows: any | any[]) {
            const arr = Array.isArray(rows) ? rows : [rows];
            const inserted = arr.map((r) => ({ id: r.id || `id-${Date.now()}-${Math.random()}`, ...r }));
            if (table === "mcp_credentials") db.mcpCredentials.push(...inserted);
            else if (table === "content_posts") db.contentPosts.push(...inserted);
            else if (table === "content_post_versions") db.contentPostVersions.push(...inserted);
            else if (table === "audit_events") db.auditEvents.push(...inserted);
            return {
              select() {
                return {
                  async single() {
                    return { data: inserted[0], error: null };
                  },
                };
              },
              then(resolve: any) {
                return resolve({ data: inserted, error: null });
              },
            };
          },
          update(updates: any) {
            let targetRows: any[] = [];
            if (table === "mcp_credentials") targetRows = db.mcpCredentials;
            else if (table === "workspaces") targetRows = db.workspaces;
            else if (table === "content_posts") targetRows = db.contentPosts;

            let filterCol: string | null = null;
            let filterVal: any = null;
            let isCol: string | null = null;
            let isVal: any = null;

            const chain = {
              eq(col: string, val: any) {
                filterCol = col;
                filterVal = val;
                return chain;
              },
              is(col: string, val: any) {
                isCol = col;
                isVal = val;
                return chain;
              },
              select() {
                return {
                  async single() {
                    const r = targetRows.find((item) => (!filterCol || item[filterCol] === filterVal));
                    if (r) Object.assign(r, updates);
                    return { data: r || null, error: null };
                  },
                };
              },
              then(resolve: any) {
                targetRows.forEach((r) => {
                  let match = true;
                  if (filterCol && r[filterCol] !== filterVal) match = false;
                  if (isCol && (isVal === null ? r[isCol] !== null && r[isCol] !== undefined : r[isCol] !== isVal)) match = false;
                  if (match) {
                    Object.assign(r, updates);
                  }
                });
                return resolve({ error: null });
              },
            };
            return chain;
          },
        };
      },
    };
  }
}

describe("Remote MCP Integration", () => {
  let mockDb: MockMcpDb;

  beforeEach(() => {
    mockDb = new MockMcpDb();
  });

  describe("Schema Discovery & Prohibitions (BED-11 / Spec §11)", () => {
    it("strictly DOES NOT expose approve_draft in MCP tool definitions", () => {
      const toolNames = MCP_TOOLS.map((t) => t.name);
      expect(toolNames).not.toContain("approve_draft");

      const hasApprovalInName = MCP_TOOLS.some((t) => t.name.includes("approve"));
      expect(hasApprovalInName).toBe(false);
    });

    it("exposes all required read and write tools with valid schemas", () => {
      const toolNames = MCP_TOOLS.map((t) => t.name);

      // Read tools
      expect(toolNames).toContain("get_agent_status");
      expect(toolNames).toContain("get_content_plan");
      expect(toolNames).toContain("list_drafts");
      expect(toolNames).toContain("get_publishing_schedule");
      expect(toolNames).toContain("get_performance_summary");
      expect(toolNames).toContain("list_recent_activity");

      // Write tools
      expect(toolNames).toContain("create_draft");
      expect(toolNames).toContain("edit_draft");
      expect(toolNames).toContain("request_draft_revision");
      expect(toolNames).toContain("reject_draft");
      expect(toolNames).toContain("pause_agent");
      expect(toolNames).toContain("resume_agent");
      expect(toolNames).toContain("schedule_post");
      expect(toolNames).toContain("cancel_scheduled_post");
    });
  });

  describe("Token Generation, Rotation, and Verification", () => {
    it("generates a high-entropy workspace-scoped token with nunuza_mcp_ prefix and SHA-256 hash", async () => {
      const client = mockDb.createClient();
      const tokenResult = await generateMcpToken("ws-aaa", "user-aaa", ["read", "write"], client);

      expect(tokenResult.rawToken).toMatch(/^nunuza_mcp_[a-f0-9]{48}$/);
      expect(mockDb.mcpCredentials.length).toBe(1);

      const stored = mockDb.mcpCredentials[0];
      const expectedHash = crypto.createHash("sha256").update(tokenResult.rawToken).digest("hex");
      expect(stored.token_hash).toBe(expectedHash);
      expect(stored.workspace_id).toBe("ws-aaa");
    });

    it("rotates tokens and immediately revokes previous active credential", async () => {
      const client = mockDb.createClient();
      const token1 = await generateMcpToken("ws-aaa", "user-aaa", ["read"], client);
      const token2 = await generateMcpToken("ws-aaa", "user-aaa", ["read", "write"], client);

      expect(mockDb.mcpCredentials.length).toBe(2);
      expect(mockDb.mcpCredentials[0].revoked_at).toBeDefined();
      expect(mockDb.mcpCredentials[1].revoked_at).toBeUndefined();

      // Old token verification fails
      const verifyOld = await verifyMcpToken(token1.rawToken, client);
      expect(verifyOld).toBeNull();

      // New token verification succeeds
      const verifyNew = await verifyMcpToken(token2.rawToken, client);
      expect(verifyNew).not.toBeNull();
      expect(verifyNew?.workspaceId).toBe("ws-aaa");
    });

    it("revokes active credential via revokeMcpToken", async () => {
      const client = mockDb.createClient();
      const token = await generateMcpToken("ws-aaa", "user-aaa", ["read"], client);

      const statusBefore = await getMcpCredentialStatus("ws-aaa", client);
      expect(statusBefore.active).toBe(true);

      await revokeMcpToken("ws-aaa", "user-aaa", client);

      const statusAfter = await getMcpCredentialStatus("ws-aaa", client);
      expect(statusAfter.active).toBe(false);

      const verifyRevoked = await verifyMcpToken(token.rawToken, client);
      expect(verifyRevoked).toBeNull();
    });
  });

  describe("Tool Execution Engine & Tenant Isolation", () => {
    it("executes get_agent_status for workspace", async () => {
      const client = mockDb.createClient();
      const res = await executeMcpTool("get_agent_status", {}, { workspaceId: "ws-aaa", userId: "user-aaa" }, client);

      expect(res.workspace_name).toBe("Founder Workspace A");
      expect(res.entitlement_type).toBe("draft_only");
      expect(res.agent_paused).toBe(false);
    });

    it("strictly isolates drafts per workspace in list_drafts", async () => {
      const client = mockDb.createClient();

      const resA = await executeMcpTool("list_drafts", {}, { workspaceId: "ws-aaa", userId: "user-aaa" }, client);
      expect(resA.drafts.length).toBe(1);
      expect(resA.drafts[0].id).toBe("post-1");

      const resB = await executeMcpTool("list_drafts", {}, { workspaceId: "ws-bbb", userId: "user-bbb" }, client);
      expect(resB.drafts.length).toBe(1);
      expect(resB.drafts[0].id).toBe("post-2");
    });

    it("creates draft in draft state with quota check", async () => {
      const client = mockDb.createClient();
      const res = await executeMcpTool(
        "create_draft",
        { text: "Fresh new post content", hook: "Did you know?" },
        { workspaceId: "ws-aaa", userId: "user-aaa" },
        client
      );

      expect(res.success).toBe(true);
      expect(res.draft.text).toBe("Fresh new post content");
      expect(res.draft.status).toBe("draft");
      expect(mockDb.contentPosts.length).toBe(3);
    });

    it("resets approved status to draft upon editing (Spec §11 requirement)", async () => {
      const client = mockDb.createClient();
      // post-2 is initially 'approved'
      expect(mockDb.contentPosts[1].status).toBe("approved");

      const res = await executeMcpTool(
        "edit_draft",
        { draft_id: "post-2", text: "Revised content needing fresh approval" },
        { workspaceId: "ws-bbb", userId: "user-bbb" },
        client
      );

      expect(res.success).toBe(true);
      expect(mockDb.contentPosts[1].status).toBe("draft");
      expect(mockDb.contentPostVersions.length).toBe(1); // saved version history
    });

    it("denies scheduling if workspace entitlement is draft_only", async () => {
      const client = mockDb.createClient();
      // ws-aaa is draft_only
      await expect(
        executeMcpTool(
          "schedule_post",
          { draft_id: "post-1", scheduled_for: new Date(Date.now() + 86400000).toISOString() },
          { workspaceId: "ws-aaa", userId: "user-aaa" },
          client
        )
      ).rejects.toThrow("ENTITLEMENT_RESTRICTED");
    });

    it("denies scheduling if draft is not approved by human", async () => {
      const client = mockDb.createClient();
      // Add unapproved draft to ws-bbb
      mockDb.contentPosts.push({
        id: "post-unapproved",
        workspace_id: "ws-bbb",
        status: "draft",
        text: "Unapproved post",
      });

      await expect(
        executeMcpTool(
          "schedule_post",
          { draft_id: "post-unapproved", scheduled_for: new Date(Date.now() + 86400000).toISOString() },
          { workspaceId: "ws-bbb", userId: "user-bbb" },
          client
        )
      ).rejects.toThrow("UNAPPROVED_DRAFT");
    });

    it("allows scheduling approved draft in publishing_beta workspace", async () => {
      const client = mockDb.createClient();
      const futureDate = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

      const res = await executeMcpTool(
        "schedule_post",
        { draft_id: "post-2", scheduled_for: futureDate },
        { workspaceId: "ws-bbb", userId: "user-bbb" },
        client
      );

      expect(res.success).toBe(true);
      expect(mockDb.contentPosts[1].status).toBe("scheduled");
    });

    it("denies access to drafts belonging to another workspace", async () => {
      const client = mockDb.createClient();
      // Workspace A attempting to edit post-2 (which belongs to Workspace B)
      await expect(
        executeMcpTool(
          "edit_draft",
          { draft_id: "post-2", text: "Hacked content" },
          { workspaceId: "ws-aaa", userId: "user-aaa" },
          client
        )
      ).rejects.toThrow("Draft not found or access denied");
    });
  });
});
