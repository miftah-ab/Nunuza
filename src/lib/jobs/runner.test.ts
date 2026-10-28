import { describe, it, expect, beforeEach } from "vitest";
import { claimDueJobs, processJob, reconcileStaleJobs } from "./runner";
import type { AgentJob } from "@/types/database";

class MockJobDb {
  jobs: AgentJob[] = [];
  attempts: any[] = [];
  workspaces: any[] = [
    {
      id: "ws-test",
      name: "Test Workspace",
      entitlement_type: "publishing_beta",
      status: "active",
      operating_mode: "approval_required",
    },
  ];

  createClient() {
    const db = this;
    return {
      from(table: string) {
        return {
          select(fields = "*") {
            let data: any[] = [];
            if (table === "agent_jobs") data = [...db.jobs];
            else if (table === "workspaces") data = [...db.workspaces];
            else if (table === "agent_job_attempts") data = [...db.attempts];

            let filtered = data;
            const chain = {
              eq(col: string, val: any) {
                filtered = filtered.filter((r) => r[col] === val);
                return chain;
              },
              or(expr: string) {
                // simple parser for status.eq.queued,status.eq.failed_retryable
                filtered = filtered.filter((r) => r.status === "queued" || r.status === "failed_retryable");
                return chain;
              },
              lte(col: string, val: any) {
                filtered = filtered.filter((r) => r[col] <= val);
                return chain;
              },
              lt(col: string, val: any) {
                filtered = filtered.filter((r) => r[col] < val);
                return chain;
              },
              order() {
                return chain;
              },
              limit(n: number) {
                filtered = filtered.slice(0, n);
                return chain;
              },
              async single() {
                const item = filtered[0];
                return item ? { data: item, error: null } : { data: null, error: new Error("Not found") };
              },
              then(resolve: any) {
                return resolve({ data: filtered, error: null });
              },
            };
            return chain;
          },
          update(updates: any) {
            let targetRows: any[] = [];
            if (table === "agent_jobs") targetRows = db.jobs;

            let filterCol: string | null = null;
            let filterVal: any = null;

            const chain = {
              eq(col: string, val: any) {
                filterCol = col;
                filterVal = val;
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
                  if (!filterCol || r[filterCol] === filterVal) {
                    Object.assign(r, updates);
                  }
                });
                return resolve({ error: null });
              },
            };
            return chain;
          },
          insert(rows: any | any[]) {
            const arr = Array.isArray(rows) ? rows : [rows];
            if (table === "agent_job_attempts") db.attempts.push(...arr);
            return Promise.resolve({ data: arr, error: null });
          },
        };
      },
    };
  }
}

describe("Durable Job Runner & Background Execution", () => {
  let mockDb: MockJobDb;

  beforeEach(() => {
    mockDb = new MockJobDb();
  });

  it("claims due unleased jobs and acquires 5-minute lease", async () => {
    const client = mockDb.createClient();
    mockDb.jobs.push({
      id: "job-1",
      workspace_id: "ws-test",
      job_type: "publish_post",
      status: "queued",
      idempotency_key: "key-1",
      payload: {},
      scheduled_for: new Date(Date.now() - 10000).toISOString(),
      attempt_count: 0,
      max_attempts: 3,
      lease_until: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any);

    const claimed = await claimDueJobs({ limit: 5 }, client);
    expect(claimed.length).toBe(1);
    expect(claimed[0].id).toBe("job-1");
    expect(mockDb.jobs[0].status).toBe("running");
    expect(mockDb.jobs[0].attempt_count).toBe(1);
    expect(new Date(mockDb.jobs[0].lease_until!).getTime()).toBeGreaterThan(Date.now());
  });

  it("skips jobs currently leased by another active worker", async () => {
    const client = mockDb.createClient();
    mockDb.jobs.push({
      id: "job-leased",
      workspace_id: "ws-test",
      job_type: "publish_post",
      status: "running",
      idempotency_key: "key-leased",
      payload: {},
      scheduled_for: new Date(Date.now() - 10000).toISOString(),
      attempt_count: 1,
      max_attempts: 3,
      lease_until: new Date(Date.now() + 180000).toISOString(), // active lease for 3 more mins
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any);

    const claimed = await claimDueJobs({ limit: 5 }, client);
    expect(claimed.length).toBe(0);
  });

  it("reconciles stale/orphaned jobs where worker lease expired while running", async () => {
    const client = mockDb.createClient();
    mockDb.jobs.push({
      id: "job-stale",
      workspace_id: "ws-test",
      job_type: "publish_post",
      status: "running",
      idempotency_key: "key-stale",
      payload: {},
      scheduled_for: new Date(Date.now() - 600000).toISOString(),
      attempt_count: 1,
      max_attempts: 3,
      lease_until: new Date(Date.now() - 60000).toISOString(), // expired 1 min ago
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any);

    const reconciled = await reconcileStaleJobs(client);
    expect(reconciled).toBe(1);
    expect(mockDb.jobs[0].status).toBe("failed_retryable");
    expect(mockDb.jobs[0].lease_until).toBeNull();
  });

  it("processes job, fails closed on unapproved publishing, and records attempt history", async () => {
    const client = mockDb.createClient();
    const job: AgentJob = {
      id: "job-exec",
      workspace_id: "ws-test",
      job_type: "publish_post",
      status: "running",
      idempotency_key: "key-exec",
      payload: { postId: "post-123" },
      scheduled_for: new Date().toISOString(),
      attempt_count: 1,
      max_attempts: 3,
      lease_until: new Date(Date.now() + 300000).toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any;
    mockDb.jobs.push(job);

    const res = await processJob(job, client);
    expect(res.success).toBe(false);
    expect(res.status).toBe("failed_terminal"); // Fail-closed per BED-03
    expect(mockDb.attempts.length).toBe(1);
    expect(mockDb.attempts[0].attempt_number).toBe(1);
  });
});
