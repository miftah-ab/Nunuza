import { describe, it, expect, beforeEach } from "vitest";
import {
  generateTelegramPairingToken,
  linkTelegramAccount,
  unlinkTelegramAccount,
  getTelegramLinkStatus,
  handleTelegramMessage,
  verifyTelegramSecret,
  isUpdateProcessed,
  markUpdateProcessed,
} from "./service";
import crypto from "crypto";

// In-memory mock database for isolated testing
class MockTelegramDb {
  linkTokens: any[] = [];
  telegramLinks: any[] = [];
  workspaces: any[] = [
    {
      id: "ws-111",
      owner_user_id: "user-111",
      name: "Acme Solo",
      entitlement_type: "draft_only",
      status: "active",
    },
    {
      id: "ws-222",
      owner_user_id: "user-222",
      name: "Beta Workspace",
      entitlement_type: "publishing_beta",
      status: "active",
    },
  ];
  contentPosts: any[] = [
    {
      id: "post-aaa-111",
      workspace_id: "ws-111",
      status: "draft",
      hook: "First draft hook",
      text: "Full draft text 1",
      created_at: new Date().toISOString(),
    },
    {
      id: "post-bbb-222",
      workspace_id: "ws-222",
      status: "draft",
      hook: "Beta draft hook",
      text: "Full draft text 2",
      created_at: new Date().toISOString(),
    },
  ];
  auditEvents: any[] = [];
  usageCounters: any[] = [];

  createClient() {
    const db = this;
    return {
      from(table: string) {
        return {
          select(fields = "*", options?: any) {
            let data: any[] = [];
            if (table === "link_tokens") data = [...db.linkTokens];
            else if (table === "telegram_links") data = [...db.telegramLinks];
            else if (table === "workspaces") data = [...db.workspaces];
            else if (table === "content_posts") data = [...db.contentPosts];
            else if (table === "usage_counters") data = [...db.usageCounters];

            let filtered = data;
            const chain = {
              eq(col: string, val: any) {
                filtered = filtered.filter((row) => row[col] === val);
                return chain;
              },
              is(col: string, val: any) {
                filtered = filtered.filter((row) => (val === null ? row[col] === null || row[col] === undefined : row[col] === val));
                return chain;
              },
              gt(col: string, val: any) {
                filtered = filtered.filter((row) => row[col] > val);
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
            if (table === "link_tokens") db.linkTokens.push(...inserted);
            else if (table === "telegram_links") db.telegramLinks.push(...inserted);
            else if (table === "audit_events") db.auditEvents.push(...inserted);
            else if (table === "content_posts") db.contentPosts.push(...inserted);
            return Promise.resolve({ data: inserted, error: null });
          },
          update(updates: any) {
            let targetRows: any[] = [];
            if (table === "link_tokens") targetRows = db.linkTokens;
            else if (table === "telegram_links") targetRows = db.telegramLinks;
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

describe("Telegram Service", () => {
  let mockDb: MockTelegramDb;

  beforeEach(() => {
    mockDb = new MockTelegramDb();
  });

  describe("Token Generation and Account Linking", () => {
    it("generates a high-entropy 15-minute pairing token and stores its SHA-256 hash", async () => {
      const client = mockDb.createClient();
      const res = await generateTelegramPairingToken("ws-111", "user-111", client);

      expect(res.token).toBeDefined();
      expect(res.token.length).toBeGreaterThan(20);
      expect(new Date(res.expiresAt).getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);

      // Verify DB contains hash, not raw token
      expect(mockDb.linkTokens.length).toBe(1);
      const stored = mockDb.linkTokens[0];
      const expectedHash = crypto.createHash("sha256").update(res.token).digest("hex");
      expect(stored.token_hash).toBe(expectedHash);
      expect(stored.workspace_id).toBe("ws-111");
    });

    it("successfully links Telegram account via valid raw pairing token", async () => {
      const client = mockDb.createClient();
      const { token } = await generateTelegramPairingToken("ws-111", "user-111", client);

      const linkRes = await linkTelegramAccount(token, 987654321, 12345678, client);
      expect(linkRes.success).toBe(true);
      expect(linkRes.workspaceId).toBe("ws-111");

      // Verify token consumed
      expect(mockDb.linkTokens[0].consumed_at).toBeDefined();

      // Verify telegram link established
      expect(mockDb.telegramLinks.length).toBe(1);
      expect(mockDb.telegramLinks[0].telegram_user_id).toBe(987654321);
      expect(mockDb.telegramLinks[0].workspace_id).toBe("ws-111");
    });

    it("rejects invalid or already-consumed token", async () => {
      const client = mockDb.createClient();
      const { token } = await generateTelegramPairingToken("ws-111", "user-111", client);

      // First link succeeds
      const first = await linkTelegramAccount(token, 987654321, 12345678, client);
      expect(first.success).toBe(true);

      // Replay attempt fails
      const second = await linkTelegramAccount(token, 999999999, 88888888, client);
      expect(second.success).toBe(false);
      expect(second.error).toContain("Invalid, expired, or already used");
    });

    it("supports unlinking and status query", async () => {
      const client = mockDb.createClient();
      const { token } = await generateTelegramPairingToken("ws-111", "user-111", client);
      await linkTelegramAccount(token, 987654321, 12345678, client);

      const statusBefore = await getTelegramLinkStatus("ws-111", client);
      expect(statusBefore.linked).toBe(true);
      expect(statusBefore.telegramUserId).toBe(987654321);

      await unlinkTelegramAccount("ws-111", client);

      const statusAfter = await getTelegramLinkStatus("ws-111", client);
      expect(statusAfter.linked).toBe(false);
    });
  });

  describe("Security and Webhook Protection", () => {
    it("validates webhook secret token", () => {
      process.env.TELEGRAM_WEBHOOK_SECRET = "super_secret_webhook_token_12345";
      expect(verifyTelegramSecret("super_secret_webhook_token_12345")).toBe(true);
      expect(verifyTelegramSecret("wrong_secret")).toBe(false);
      expect(verifyTelegramSecret(null)).toBe(false);
    });

    it("deduplicates update_id to prevent replay attacks", () => {
      const updateId = 554433221;
      expect(isUpdateProcessed(updateId)).toBe(false);

      markUpdateProcessed(updateId);
      expect(isUpdateProcessed(updateId)).toBe(true);
    });
  });

  describe("Command Processor", () => {
    it("notifies non-linked user how to connect", async () => {
      const client = mockDb.createClient();
      const res = await handleTelegramMessage(
        { telegramUserId: 111222, chatId: 333444, text: "/status" },
        client
      );

      expect(res.replyText).toContain("Nunuza Account Not Linked");
      expect(res.replyText).toContain("Integrations");
    });

    it("handles /status for connected workspace", async () => {
      const client = mockDb.createClient();
      const { token } = await generateTelegramPairingToken("ws-111", "user-111", client);
      await linkTelegramAccount(token, 555666, 777888, client);

      const res = await handleTelegramMessage(
        { telegramUserId: 555666, chatId: 777888, text: "/status" },
        client
      );

      expect(res.replyText).toContain("Acme Solo");
      expect(res.replyText).toContain("draft_only");
      expect(res.replyText).toContain("Drafts Awaiting Review");
    });

    it("handles /pause and /resume agent states", async () => {
      const client = mockDb.createClient();
      const { token } = await generateTelegramPairingToken("ws-111", "user-111", client);
      await linkTelegramAccount(token, 555666, 777888, client);

      const pauseRes = await handleTelegramMessage(
        { telegramUserId: 555666, chatId: 777888, text: "/pause" },
        client
      );
      expect(pauseRes.replyText).toContain("Agent Paused");
      expect(mockDb.workspaces[0].status).toBe("paused");

      const resumeRes = await handleTelegramMessage(
        { telegramUserId: 555666, chatId: 777888, text: "/resume" },
        client
      );
      expect(resumeRes.replyText).toContain("Agent Resumed");
      expect(mockDb.workspaces[0].status).toBe("active");
    });

    it("lists drafts via /drafts", async () => {
      const client = mockDb.createClient();
      const { token } = await generateTelegramPairingToken("ws-111", "user-111", client);
      await linkTelegramAccount(token, 555666, 777888, client);

      const res = await handleTelegramMessage(
        { telegramUserId: 555666, chatId: 777888, text: "/drafts" },
        client
      );

      expect(res.replyText).toContain("First draft hook");
      expect(res.replyText).toContain("/approve");
    });

    it("strictly rejects /approve if workspace entitlement is draft_only (BED-01/02)", async () => {
      const client = mockDb.createClient();
      const { token } = await generateTelegramPairingToken("ws-111", "user-111", client);
      await linkTelegramAccount(token, 555666, 777888, client);

      const res = await handleTelegramMessage(
        { telegramUserId: 555666, chatId: 777888, text: "/approve post-aaa" },
        client
      );

      expect(res.replyText).toContain("Action Restricted in Draft-Only Preview");
      expect(res.replyText).toContain("draft_only");
      // Must not approve in DB
      expect(mockDb.contentPosts[0].status).toBe("draft");
    });

    it("allows /approve if workspace entitlement is publishing_beta", async () => {
      const client = mockDb.createClient();
      const { token } = await generateTelegramPairingToken("ws-222", "user-222", client);
      await linkTelegramAccount(token, 777999, 888111, client);

      const res = await handleTelegramMessage(
        { telegramUserId: 777999, chatId: 888111, text: "/approve post-bbb" },
        client
      );

      expect(res.replyText).toContain("Draft Approved!");
      expect(mockDb.contentPosts[1].status).toBe("approved");
    });

    it("handles /reject and updates draft status", async () => {
      const client = mockDb.createClient();
      const { token } = await generateTelegramPairingToken("ws-111", "user-111", client);
      await linkTelegramAccount(token, 555666, 777888, client);

      const res = await handleTelegramMessage(
        { telegramUserId: 555666, chatId: 777888, text: "/reject post-aaa Needs a punchier opening" },
        client
      );

      expect(res.replyText).toContain("Draft Rejected");
      expect(mockDb.contentPosts[0].status).toBe("rejected");
      expect(mockDb.contentPosts[0].rejection_reason).toBe("Needs a punchier opening");
    });
  });
});
