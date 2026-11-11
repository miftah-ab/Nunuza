import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiService } from "@/lib/ai/service";
import { buildDraftPrompt } from "@/lib/ai/prompts";
import { handleTelegramConversation, isRevisionRequest } from "./conversation";

vi.mock("@/lib/ai/service", () => ({
  aiService: { generateDraft: vi.fn() },
}));

class FakeQuery {
  table: string;
  db: FakeDb;
  operation: "select" | "insert" | "update" = "select";
  payload: any;
  filters: Record<string, any> = {};
  selected = false;

  constructor(db: FakeDb, table: string) { this.db = db; this.table = table; }
  select() { this.selected = true; return this; }
  eq(key: string, value: any) { this.filters[key] = value; return this; }
  maybeSingle() {
    if (this.table === "content_posts") {
      const post = this.db.posts.find((row) => row.id === this.filters.id && row.workspace_id === this.filters.workspace_id);
      return Promise.resolve({ data: post ?? null, error: null });
    }
    if (this.table === "usage_counters") return Promise.resolve({ data: null, error: null });
    return Promise.resolve({ data: null, error: null });
  }
  single() {
    if (this.table === "content_posts" && this.operation === "insert") {
      const post = { id: "post-12345678", version: 1, status: "draft", ...this.payload };
      this.db.posts.push(post);
      return Promise.resolve({ data: post, error: null });
    }
    if (this.table === "content_posts" && this.operation === "update") {
      const post = this.db.posts.find((row) => row.id === this.filters.id && row.workspace_id === this.filters.workspace_id && row.status === this.filters.status);
      if (!post) return Promise.resolve({ data: null, error: new Error("Not found") });
      Object.assign(post, this.payload);
      return Promise.resolve({ data: post, error: null });
    }
    return Promise.resolve({ data: null, error: new Error("Unexpected single") });
  }
  insert(payload: any) {
    this.operation = "insert";
    this.payload = payload;
    if (this.table === "content_post_versions") this.db.versions.push(payload);
    if (this.table === "audit_events") this.db.audit.push(payload);
    return this;
  }
  update(payload: any) { this.operation = "update"; this.payload = payload; return this; }
  then(resolve: (value: any) => any) {
    return Promise.resolve({ data: null, error: null }).then(resolve);
  }
}

class FakeDb {
  posts: any[] = [];
  versions: any[] = [];
  audit: any[] = [];
  releasedState: any = null;
  state: any = {};
  rpcCalls: string[] = [];
  from(table: string) { return new FakeQuery(this, table); }
  async rpc(name: string, args: any) {
    this.rpcCalls.push(name);
    if (name === "claim_telegram_conversation") return { data: { claimed: true, state: this.state }, error: null };
    if (name === "release_telegram_conversation") { this.releasedState = args.p_state; this.state = args.p_state; return { data: true, error: null }; }
    if (name === "increment_usage_counter") return { data: 1, error: null };
    return { data: null, error: new Error("Unexpected RPC") };
  }
}

describe("Telegram conversational content", () => {
  beforeEach(() => vi.clearAllMocks());

  it("classifies revision instructions only when a draft is active", () => {
    expect(isRevisionRequest("Make the opening stronger", true)).toBe(true);
    expect(isRevisionRequest("Make it shorter", false)).toBe(false);
    expect(isRevisionRequest("Write a new post about hiring", true)).toBe(false);
    expect(isRevisionRequest("/new", true)).toBe(false);
  });

  it("adds the existing draft and user instruction as untrusted revision context", () => {
    const prompt = buildDraftPrompt({
      topic: "Hiring lessons",
      revision: { previousDraft: "Old draft text", instruction: "Make the hook stronger" },
    });
    expect(prompt.userPrompt).toContain("REVISION MODE");
    expect(prompt.userPrompt).toContain("Old draft text");
    expect(prompt.userPrompt).toContain("Make the hook stronger");
  });

  it("creates and persists a draft without publishing it", async () => {
    vi.mocked(aiService.generateDraft).mockResolvedValue({
      text: "A useful LinkedIn post with a clear point.",
      internalTitle: "A useful lesson",
      providerUsed: "groq",
      modelUsed: "test-model",
      estimatedTokens: 30,
      generatedAt: new Date().toISOString(),
    });
    const db = new FakeDb();
    const result = await handleTelegramConversation({
      telegramUserId: 111,
      chatId: 222,
      workspaceId: "workspace-1",
      ownerUserId: "user-1",
      text: "Write a LinkedIn post about hiring carefully",
      supabase: db,
    });

    expect(result.replyText).toContain("New draft created");
    expect(result.replyText).toContain("A useful LinkedIn post");
    expect(db.posts).toHaveLength(1);
    expect(db.posts[0].status).toBe("draft");
    expect(db.versions).toHaveLength(1);
    expect(db.audit[0].action).toBe("telegram_draft_created");
    expect(db.rpcCalls).toContain("increment_usage_counter");
    expect(db.releasedState.activePostId).toBe(db.posts[0].id);
    expect(result.replyText).not.toContain("Published to LinkedIn");
  });

  it("revises the active draft in place and does not consume a second draft slot", async () => {
    vi.mocked(aiService.generateDraft).mockResolvedValue({
      text: "A stronger revised opening and post.",
      internalTitle: "Hiring lessons",
      pillar: "Leadership",
      providerUsed: "groq",
      modelUsed: "test-model",
      estimatedTokens: 35,
      generatedAt: new Date().toISOString(),
    });
    const db = new FakeDb();
    db.state = {
      activePostId: "post-12345678",
      topic: "Hiring lessons",
      pillar: "Leadership",
      updatedAt: new Date().toISOString(),
    };
    db.posts.push({
      id: "post-12345678",
      workspace_id: "workspace-1",
      text: "Old draft text",
      internal_title: "Hiring lessons",
      pillar: "Leadership",
      version: 1,
      status: "draft",
    });

    const result = await handleTelegramConversation({
      telegramUserId: 111,
      chatId: 222,
      workspaceId: "workspace-1",
      ownerUserId: "user-1",
      text: "Make the opening stronger",
      supabase: db,
    });

    expect(result.replyText).toContain("Draft revised");
    expect(db.posts).toHaveLength(1);
    expect(db.posts[0].text).toBe("A stronger revised opening and post.");
    expect(db.posts[0].version).toBe(2);
    expect(db.versions).toHaveLength(1);
    expect(db.versions[0].change_source).toBe("ai_revision");
    expect(db.rpcCalls).not.toContain("increment_usage_counter");
    expect(vi.mocked(aiService.generateDraft).mock.calls[0][0].revision).toEqual({
      previousDraft: "Old draft text",
      instruction: "Make the opening stronger",
    });
  });
});
