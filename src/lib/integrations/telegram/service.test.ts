import { describe, it, expect, beforeEach } from "vitest";
import {
  generateTelegramPairingToken,
  linkTelegramAccount,
  unlinkTelegramAccount,
  getTelegramLinkStatus,
  handleTelegramMessage,
  verifyTelegramSecret,
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
      state: "active_approval_required",
      operating_mode: "approval_required",
      paused_at: null,
    },
    {
      id: "ws-222",
      owner_user_id: "user-222",
      name: "Beta Workspace",
      entitlement_type: "publishing_beta",
      state: "active_approval_required",
      operating_mode: "approval_required",
      paused_at: null,
    },
  ];
  contentPosts: any[] = [
    {
      id: "post-aaa-111",
      workspace_id: "ws-111",
      status: "draft",
      internal_title: "First draft hook",
      text: "Full draft text 1",
      created_at: new Date().toISOString(),
    },
    {
      id: "post-bbb-222",
      workspace_id: "ws-222",
      status: "draft",
      internal_title: "Beta draft hook",
      text: "Full draft text 2",
      created_at: new Date().toISOString(),
    },
  ];
  auditEvents: any[] = [];
  approvalEvents: any[] = [];
  usageCounters: any[] = [];

  createClient() {
    const db = this;
    return {
      rpc(name: string, args: any) {
        if (name !== "link_telegram_account") return Promise.resolve({ data: null, error: new Error("Unknown RPC") });
        const token = db.linkTokens.find((row) =>
          row.token_hash === args.p_token_hash && !row.consumed_at && row.expires_at > new Date().toISOString()
        );
        if (!token) return Promise.resolve({ data: null, error: null });
        token.consumed_at = new Date().toISOString();
        db.telegramLinks
          .filter((row) => !row.revoked_at && (row.workspace_id === token.workspace_id || row.telegram_user_id === args.p_telegram_user_id))
          .forEach((row) => { row.revoked_at = new Date().toISOString(); });
        db.telegramLinks.push({
          id: `telegram-link-${db.telegramLinks.length + 1}`,
          workspace_id: token.workspace_id,
          telegram_user_id: args.p_telegram_user_id,
          chat_id: args.p_chat_id,
          linked_at: new Date().toISOString(),
          revoked_at: null,
        });
        db.auditEvents.push({ workspace_id: token.workspace_id, action: "telegram_linked" });
        return Promise.resolve({ data: token.workspace_id, error: null });
      },
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
              in(col: string, vals: any[]) {
                filtered = filtered.filter((row) => vals.includes(row[col]));
                return chain;
              },
              like(col: string, pattern: string) {
                const prefix = pattern.endsWith("%") ? pattern.slice(0, -1) : pattern;
                filtered = filtered.filter((row) => String(row[col] ?? "").startsWith(prefix));
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
            else if (table === "approval_events") db.approvalEvents.push(...inserted);
            else if (table === "content_posts") db.contentPosts.push(...inserted);
            return Promise.resolve({ data: inserted, error: null });
          },
          update(updates: any) {
            let targetRows: any[] = [];
            if (table === "link_tokens") targetRows = db.linkTokens;
            else if (table === "telegram_links") targetRows = db.telegramLinks;
            else if (table === "workspaces") targetRows = db.workspaces;
            else if (table === "content_posts") targetRows = db.contentPosts;

            const filters: Array<(r: any) => boolean> = [];
            let returning = false;

            const chain: any = {
              eq(col: string, val: any) {
                filters.push((r) => r[col] === val);
                return chain;
              },
              in(col: string, vals: any[]) {
                filters.push((r) => vals.includes(r[col]));
                return chain;
              },
              is(col: string, val: any) {
                filters.push((r) =>
                  val === null ? r[col] === null || r[col] === undefined : r[col] === val
                );
                return chain;
              },
              select() {
                returning = true;
                return chain;
              },
              then(resolve: any) {
                const matched = targetRows.filter((r) => filters.every((f) => f(r)));
                matched.forEach((r) => Object.assign(r, updates));
                return resolve({
                  data: returning ? matched.map((r) => ({ id: r.id })) : null,
                  error: null,
                });
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

    it("rejects webhook requests without a configured secret outside tests", () => {
      const previous = process.env.TELEGRAM_WEBHOOK_SECRET;
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
      const previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      expect(verifyTelegramSecret("anything")).toBe(false);
      if (previous === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
      else process.env.TELEGRAM_WEBHOOK_SECRET = previous;
      process.env.NODE_ENV = previousNodeEnv;
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

    it("does not authorize a linked Telegram user from a different chat", async () => {
      const client = mockDb.createClient();
      const { token } = await generateTelegramPairingToken("ws-111", "user-111", client);
      await linkTelegramAccount(token, 555666, 777888, client);

      const res = await handleTelegramMessage(
        { telegramUserId: 555666, chatId: 999000, text: "/drafts", chatType: "private" },
        client
      );

      expect(res.replyText).toContain("Nunuza Account Not Linked");
      expect(res.replyText).not.toContain("First draft hook");
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
      // Entitlement is rendered as `draft\_only` in Markdown mode (escaped underscore)
      expect(res.replyText).toMatch(/draft[_\\]*only/);
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
      expect(mockDb.workspaces[0].state).toBe("paused");
      expect(mockDb.workspaces[0].paused_at).not.toBeNull();

      const resumeRes = await handleTelegramMessage(
        { telegramUserId: 555666, chatId: 777888, text: "/resume" },
        client
      );
      expect(resumeRes.replyText).toContain("Agent Resumed");
      expect(mockDb.workspaces[0].state).toBe("active_approval_required");
      expect(mockDb.workspaces[0].paused_at).toBeNull();
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
      expect(res.replyText).toContain("post-aaa");
      mockDb.contentPosts.push({
        id: "post-needs-review", workspace_id: "ws-111",
        internal_title: "Agent generated review draft", text: "Review this agent draft",
        status: "needs_review", created_at: new Date().toISOString(),
      });
      const reviewRes = await handleTelegramMessage(
        { telegramUserId: 555666, chatId: 777888, text: "/drafts" },
        client
      );
      expect(reviewRes.replyText).toContain("Agent generated review draft");
    });

    it("strictly rejects /approve if workspace entitlement is draft_only (BED-01/02)", async () => {
      const client = mockDb.createClient();
      const { token } = await generateTelegramPairingToken("ws-111", "user-111", client);
      await linkTelegramAccount(token, 555666, 777888, client);

      const res = await handleTelegramMessage(
        { telegramUserId: 555666, chatId: 777888, text: "/approve post-aaa" },
        client
      );

      expect(res.replyText).toContain("Action Restricted: Subscription or Beta Required");
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

    it("does not claim approval for a draft that is not approvable (no silent failure)", async () => {
      const client = mockDb.createClient();
      mockDb.contentPosts[1].status = "published";
      const { token } = await generateTelegramPairingToken("ws-222", "user-222", client);
      await linkTelegramAccount(token, 777999, 888111, client);

      const res = await handleTelegramMessage(
        { telegramUserId: 777999, chatId: 888111, text: "/approve post-bbb" },
        client
      );

      expect(res.replyText).not.toContain("Draft Approved!");
      expect(mockDb.contentPosts[1].status).toBe("published");
    });

    it("never writes the nonexistent approved_at column when approving", async () => {
      const client = mockDb.createClient();
      const { token } = await generateTelegramPairingToken("ws-222", "user-222", client);
      await linkTelegramAccount(token, 777999, 888111, client);

      await handleTelegramMessage(
        { telegramUserId: 777999, chatId: 888111, text: "/approve post-bbb" },
        client
      );

      expect("approved_at" in mockDb.contentPosts[1]).toBe(false);
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
      expect(mockDb.approvalEvents[0].reason).toBe("Needs a punchier opening");
      expect(mockDb.approvalEvents[0].action).toBe("rejected");
    });
  });
});
