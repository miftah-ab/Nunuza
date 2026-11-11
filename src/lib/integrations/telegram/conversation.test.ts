import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiService } from "@/lib/ai/service";
import { buildDraftPrompt } from "@/lib/ai/prompts";
import type { AgentJob } from "@/types/database";
import { executeTelegramContentJob, handleTelegramConversation, isRevisionRequest } from "./conversation";

vi.mock("@/lib/ai/service", () => ({
  aiService: { generateDraft: vi.fn() },
}));
vi.mock("./service", () => ({
  sendTelegramMessage: vi.fn().mockResolvedValue({ ok: true }),
}));

class FakeQuery {
  table: string;
  db: FakeDb;
  operation: "select" | "insert" | "update" = "select";
  payload: any;
  filters: Record<string, any> = {};

  constructor(db: FakeDb, table: string) { this.db = db; this.table = table; }
  select() { return this; }
  eq(key: string, value: any) { this.filters[key] = value; return this; }
  is(key: string, value: any) { this.filters[key] = value; return this; }
  contains(key: string, value: any) { this.filters[key] = value; return this; }
  maybeSingle() {
    if (this.table === "telegram_links") {
      return Promise.resolve({ data: { conversation_state: this.db.conversationState }, error: null });
    }
    if (this.table === "agent_jobs") {
      const row = this.db.jobs.find((item) => item.id === this.filters.id || item.idempotency_key === this.filters.idempotency_key);
      return Promise.resolve({ data: row ?? null, error: null });
    }
    if (this.table === "content_posts") {
      const row = this.db.posts.find((item) =>
        (!this.filters.id || item.id === this.filters.id) &&
        (!this.filters.telegram_job_id || item.telegram_job_id === this.filters.telegram_job_id) &&
        (!this.filters.workspace_id || item.workspace_id === this.filters.workspace_id)
      );
      return Promise.resolve({ data: row ?? null, error: null });
    }
    if (this.table === "content_post_versions") {
      const row = this.db.versions.find((item) => item.telegram_job_id === this.filters.telegram_job_id);
      return Promise.resolve({ data: row ?? null, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  }
  single() {
    if (this.table === "agent_jobs" && this.operation === "insert") {
      const job = { id: "job-12345678", status: "queued", workspace_id: this.payload.workspace_id, ...this.payload };
      this.db.jobs.push(job);
      return Promise.resolve({ data: job, error: null });
    }
    if (this.table === "content_posts" && this.operation === "insert") {
      const post = { id: "post-12345678", version: 1, status: "draft", ...this.payload };
      this.db.posts.push(post);
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
  jobs: any[] = [];
  posts: any[] = [];
  versions: any[] = [];
  audit: any[] = [];
  conversationState: any = {};
  rpcCalls: string[] = [];
  from(table: string) { return new FakeQuery(this, table); }
  async rpc(name: string, args: any) {
    this.rpcCalls.push(name);
    if (name === "claim_telegram_conversation") return { data: { claimed: true, state: this.conversationState }, error: null };
    if (name === "enqueue_telegram_content_job") {
      const job = {
        id: args.p_job_id, status: "queued", workspace_id: args.p_workspace_id,
        job_type: "telegram_content_generation", idempotency_key: args.p_idempotency_key,
        payload: args.p_payload,
      };
      this.jobs.push(job);
      this.conversationState = { ...args.p_conversation_state, pendingJobId: args.p_job_id };
      return { data: { queued: true, job_id: args.p_job_id, status: "queued" }, error: null };
    }
    if (name === "release_telegram_conversation") {
      this.conversationState = args.p_state;
      return { data: true, error: null };
    }
    if (name === "reserve_draft_usage") return { data: true, error: null };
    if (name === "release_draft_usage") return { data: true, error: null };
    if (name === "complete_telegram_conversation_job") {
      this.conversationState = args.p_state;
      return { data: true, error: null };
    }
    return { data: null, error: new Error("Unexpected RPC") };
  }
}

const generation = {
  text: "A useful LinkedIn post with a clear point.",
  internalTitle: "A useful lesson",
  providerUsed: "groq" as const,
  modelUsed: "test-model",
  estimatedTokens: 30,
  generatedAt: new Date().toISOString(),
};

describe("Telegram conversational content", () => {
  beforeEach(() => vi.clearAllMocks());

  it("classifies revision instructions only when a draft is active", () => {
    expect(isRevisionRequest("Make the opening stronger", true)).toBe(true);
    expect(isRevisionRequest("Make it shorter", false)).toBe(false);
    expect(isRevisionRequest("Write a new post about hiring", true)).toBe(false);
    expect(isRevisionRequest("I don't like this opening", true)).toBe(true);
    expect(isRevisionRequest("The example needs more detail", true)).toBe(true);
    expect(isRevisionRequest("/new", true)).toBe(false);
  });

  it("adds the existing draft and user instruction as untrusted revision context", () => {
    const prompt = buildDraftPrompt({
      topic: "Hiring lessons",
      strategy: { pillars: ["Founder lessons", "AI operations"] },
      revision: { previousDraft: "Old draft text", instruction: "Make the hook stronger" },
    });
    expect(prompt.systemPrompt).toContain("Founder lessons, AI operations");
    expect(prompt.userPrompt).toContain("REVISION MODE");
    expect(prompt.userPrompt).toContain("Old draft text");
    expect(prompt.userPrompt).toContain("Make the hook stronger");
  });

  it("queues natural-language requests without blocking the Telegram webhook on AI", async () => {
    const db = new FakeDb();
    const result = await handleTelegramConversation({
      telegramUserId: 111,
      chatId: 222,
      workspaceId: "workspace-1",
      ownerUserId: "user-1",
      updateId: 987654,
      text: "Write a LinkedIn post about hiring carefully",
      supabase: db,
    });

    expect(result.replyText).toContain("I'm working on your LinkedIn post");
    expect(db.jobs).toHaveLength(1);
    expect(db.jobs[0].job_type).toBe("telegram_content_generation");
    expect(db.jobs[0].idempotency_key).toBe("telegram-content-987654");
    expect(db.rpcCalls).toContain("enqueue_telegram_content_job");
    expect(db.jobs[0].payload.text).toContain("hiring carefully");
    expect(db.conversationState.pendingJobId).toBe(db.jobs[0].id);
    expect(aiService.generateDraft).not.toHaveBeenCalled();
  });

  it("creates a persisted draft in the worker and never publishes it", async () => {
    vi.mocked(aiService.generateDraft).mockResolvedValue(generation);
    const db = new FakeDb();
    db.conversationState = { pendingJobId: "job-12345678" };
    const job = {
      id: "job-12345678",
      workspace_id: "workspace-1",
      job_type: "telegram_content_generation",
      status: "running",
      idempotency_key: "telegram-content-987654",
      payload: {
        telegramUserId: 111,
        chatId: 222,
        ownerUserId: "user-1",
        text: "Write a LinkedIn post about hiring carefully",
        mode: "new",
        topic: "Write a LinkedIn post about hiring carefully",
      },
      scheduled_for: new Date().toISOString(),
      started_at: new Date().toISOString(),
      finished_at: null,
      attempt_count: 1,
      max_attempts: 3,
      lease_until: new Date(Date.now() + 60_000).toISOString(),
      correlation_id: "correlation-1",
      last_error_code: null,
      safe_error_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as AgentJob;

    const result = await executeTelegramContentJob(job, db);

    expect(result.success).toBe(true);
    expect(db.posts).toHaveLength(1);
    expect(db.posts[0].status).toBe("draft");
    expect(db.posts[0].telegram_job_id).toBe(job.id);
    expect(db.versions).toHaveLength(1);
    expect(db.versions[0].telegram_job_id).toBe(job.id);
    expect(db.audit[0].action).toBe("telegram_draft_created");
    expect(db.rpcCalls).toContain("reserve_draft_usage");
    expect(db.conversationState.activePostId).toBe(db.posts[0].id);
    expect(db.conversationState.pendingJobId).toBeUndefined();
  });

  it("releases a reserved draft slot when generation exhausts retries", async () => {
    vi.mocked(aiService.generateDraft).mockRejectedValue(new Error("provider unavailable"));
    const db = new FakeDb();
    db.conversationState = { pendingJobId: "job-terminal-123" };
    const now = new Date().toISOString();
    const job = {
      id: "job-terminal-123",
      workspace_id: "workspace-1",
      job_type: "telegram_content_generation",
      status: "running",
      idempotency_key: "telegram-content-987655",
      payload: {
        telegramUserId: 111,
        chatId: 222,
        ownerUserId: "user-1",
        text: "Write a LinkedIn post about hiring carefully",
        mode: "new",
        topic: "Hiring carefully",
      },
      scheduled_for: now,
      started_at: now,
      finished_at: null,
      attempt_count: 3,
      max_attempts: 3,
      lease_until: new Date(Date.now() + 60_000).toISOString(),
      correlation_id: "correlation-terminal",
      last_error_code: null,
      safe_error_message: null,
      created_at: now,
      updated_at: now,
    } as AgentJob;

    const result = await executeTelegramContentJob(job, db);

    expect(result.status).toBe("failed_terminal");
    expect(db.rpcCalls).toContain("reserve_draft_usage");
    expect(db.rpcCalls).toContain("release_draft_usage");
  });

});
