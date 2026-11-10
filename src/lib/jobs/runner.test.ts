import { describe, it, expect, beforeEach, vi } from "vitest";
import { claimDueJobs, isClaimedAgentJobEnvelope, processJob, reconcileStaleJobs, registerJobHandler, renewAgentJobLease } from "./runner";
import { backoffSeconds, isAllowedTransition, JobTransitionError, transitionJob } from "./state";
import { MockSupabase, makeJob } from "@/test/mock-supabase";
import type { AgentJob } from "@/types/database";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
}));

describe("claimed queue envelope validation", () => {
  it("accepts a complete running claim returned by the database", () => {
    const job = makeJob({
      status: "running",
      attempt_count: 1,
      lease_until: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(isClaimedAgentJobEnvelope(job)).toBe(true);
  });

  it("rejects unclaimed, malformed, and exhausted queue messages", () => {
    expect(isClaimedAgentJobEnvelope(null)).toBe(false);
    expect(isClaimedAgentJobEnvelope({ id: "x", workspace_id: "w" })).toBe(false);
    expect(isClaimedAgentJobEnvelope(makeJob({ status: "queued" }))).toBe(false);
    expect(isClaimedAgentJobEnvelope(makeJob({
      status: "running",
      attempt_count: 4,
      max_attempts: 3,
      lease_until: new Date(Date.now() + 60_000).toISOString(),
    }))).toBe(false);
  });
});

describe("job state machine", () => {
  it("uses the database enum value 'succeeded', never 'completed'", () => {
    expect(isAllowedTransition("running", "succeeded")).toBe(true);
    expect(isAllowedTransition("running", "completed" as any)).toBe(false);
  });

  it("does not allow leaving terminal states", () => {
    expect(isAllowedTransition("succeeded", "running")).toBe(false);
    expect(isAllowedTransition("failed_terminal", "queued")).toBe(false);
    expect(isAllowedTransition("canceled", "running")).toBe(false);
  });

  it("only lets a human-resolved path leave needs_reconciliation", () => {
    expect(isAllowedTransition("needs_reconciliation", "running")).toBe(false);
    expect(isAllowedTransition("needs_reconciliation", "queued")).toBe(false);
    expect(isAllowedTransition("needs_reconciliation", "succeeded")).toBe(true);
  });

  it("fences state transitions by the exact attempt and lease", async () => {
    const db = new MockSupabase();
    const lease = new Date(Date.now() + 60_000).toISOString();
    db.jobs.push(makeJob({ status: "running", attempt_count: 2, lease_until: lease }));

    await expect(transitionJob(
      db,
      "job-1",
      "running",
      "succeeded",
      {},
      { attemptCount: 1, leaseUntil: lease }
    )).rejects.toThrow(JobTransitionError);

    expect(db.jobs[0].status).toBe("running");
    await transitionJob(
      db,
      "job-1",
      "running",
      "succeeded",
      {},
      { attemptCount: 2, leaseUntil: lease }
    );
    expect(db.jobs[0].status).toBe("succeeded");
  });

  it("backs off exponentially and caps at one hour", () => {
    expect(backoffSeconds(1)).toBe(120);
    expect(backoffSeconds(2)).toBe(240);
    expect(backoffSeconds(3)).toBe(480);
    expect(backoffSeconds(20)).toBe(3600);
  });
});

describe("claimDueJobs (atomic claim contract)", () => {
  let db: MockSupabase;
  beforeEach(() => {
    db = new MockSupabase();
  });

  it("claims a due unleased job: running, lease in the future, attempt counted once", async () => {
    db.jobs.push(makeJob());
    const claimed = await claimDueJobs({ limit: 5 }, db);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].id).toBe("job-1");
    expect(db.jobs[0].status).toBe("running");
    expect(db.jobs[0].attempt_count).toBe(1);
    expect(new Date(db.jobs[0].lease_until).getTime()).toBeGreaterThan(Date.now());
  });

  it("does not claim a job with an active lease", async () => {
    db.jobs.push(
      makeJob({ status: "queued", lease_until: new Date(Date.now() + 180_000).toISOString() })
    );
    expect(await claimDueJobs({ limit: 5 }, db)).toHaveLength(0);
  });

  it("claims a job whose lease has expired", async () => {
    db.jobs.push(
      makeJob({ status: "failed_retryable", lease_until: new Date(Date.now() - 1000).toISOString() })
    );
    expect(await claimDueJobs({ limit: 5 }, db)).toHaveLength(1);
  });

  it("respects scheduled_for, including retry backoff", async () => {
    db.jobs.push(
      makeJob({ id: "future", scheduled_for: new Date(Date.now() + 60_000).toISOString() }),
      makeJob({
        id: "backoff",
        status: "failed_retryable",
        attempt_count: 1,
        scheduled_for: new Date(Date.now() + 120_000).toISOString(),
      })
    );
    expect(await claimDueJobs({ limit: 5 }, db)).toHaveLength(0);
  });

  it("never claims jobs that are running, succeeded, canceled or needs_reconciliation", async () => {
    for (const status of ["running", "succeeded", "failed_terminal", "canceled", "needs_reconciliation"]) {
      db.jobs.push(makeJob({ id: `j-${status}`, status }));
    }
    expect(await claimDueJobs({ limit: 10 }, db)).toHaveLength(0);
  });

  it("terminalizes exhausted jobs instead of claiming them", async () => {
    db.jobs.push(makeJob({ attempt_count: 3, max_attempts: 3, status: "failed_retryable" }));
    const claimed = await claimDueJobs({ limit: 5 }, db);
    expect(claimed).toHaveLength(0);
    expect(db.jobs[0].status).toBe("failed_terminal");
    expect(db.jobs[0].last_error_code).toBe("MAX_ATTEMPTS_EXCEEDED");
  });

  it("two workers claiming at once never receive the same job", async () => {
    for (let i = 0; i < 5; i++) db.jobs.push(makeJob({ id: `job-${i}`, idempotency_key: `k-${i}` }));
    const [a, b] = await Promise.all([
      claimDueJobs({ limit: 3 }, db),
      claimDueJobs({ limit: 3 }, db),
    ]);
    const ids = [...a, ...b].map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(5);
    expect(db.jobs.every((j) => j.attempt_count === 1)).toBe(true);
  });

  it("filters by job type when requested", async () => {
    db.jobs.push(makeJob({ id: "a", job_type: "publish_post" }), makeJob({ id: "b", job_type: "other" }));
    const claimed = await claimDueJobs({ limit: 5, jobTypes: ["other"] }, db);
    expect(claimed.map((j) => j.id)).toEqual(["b"]);
  });

  it("throws on database failure instead of returning an empty list", async () => {
    db.opts.rpcError = "connection refused";
    await expect(claimDueJobs({ limit: 5 }, db)).rejects.toThrow("claim_due_agent_jobs failed");
  });
});

describe("worker lease renewal", () => {
  it("extends only the active attempt's exact lease without incrementing attempts", async () => {
    const db = new MockSupabase();
    const originalLease = new Date(Date.now() + 5 * 60_000).toISOString();
    db.jobs.push(makeJob({
      status: "running",
      attempt_count: 1,
      lease_until: originalLease,
    }));

    const renewedLease = await renewAgentJobLease(db, "job-1", 1, originalLease);
    expect(Date.parse(renewedLease)).toBeGreaterThan(Date.parse(originalLease));
    expect(db.jobs[0].lease_until).toBe(renewedLease);
    expect(db.jobs[0].attempt_count).toBe(1);

    await expect(renewAgentJobLease(db, "job-1", 1, originalLease))
      .rejects.toThrow(/Lease ownership lost/);
    await expect(renewAgentJobLease(db, "job-1", 2, renewedLease))
      .rejects.toThrow(/Lease ownership lost/);
  });
});

describe("processJob", () => {
  let db: MockSupabase;
  beforeEach(() => {
    db = new MockSupabase();
  });

  it("marks a successful job 'succeeded' (not 'completed') and records the attempt", async () => {
    registerJobHandler("test_ok", async (job) => ({
      jobId: job.id,
      success: true,
      status: "succeeded",
      retryable: false,
    }));
    const job = makeJob({ job_type: "test_ok", status: "running", attempt_count: 1 });
    db.jobs.push(job);

    const res = await processJob(job, db);
    expect(res.success).toBe(true);
    expect(db.jobs[0].status).toBe("succeeded");
    expect(db.attempts).toHaveLength(1);
    expect(db.attempts[0].attempt_number).toBe(1);
  });

  it("does not finalize a job after another attempt has taken ownership", async () => {
    registerJobHandler("test_lease_lost", async (job, supabase) => {
      supabase.jobs[0].attempt_count = job.attempt_count + 1;
      supabase.jobs[0].lease_until = new Date(Date.now() + 60_000).toISOString();
      return {
        jobId: job.id,
        success: true,
        status: "succeeded",
        retryable: false,
      };
    });
    const job = makeJob({
      job_type: "test_lease_lost",
      status: "running",
      attempt_count: 1,
      lease_until: new Date(Date.now() + 60_000).toISOString(),
    });
    db.jobs.push(job);

    const result = await processJob(job, db);

    expect(result.success).toBe(false);
    expect(result.error).toContain("lease was lost");
    expect(db.jobs[0].status).toBe("running");
    expect(db.attempts).toHaveLength(0);
  });

  it("skips a job that is no longer running (queue redelivery after completion)", async () => {
    const handler = vi.fn();
    registerJobHandler("test_skip", handler);
    db.jobs.push(makeJob({ job_type: "test_skip", status: "succeeded" }));

    const res = await processJob(makeJob({ job_type: "test_skip", status: "running" }), db);
    expect(res.success).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(db.jobs[0].status).toBe("succeeded");
  });

  it("retries retryable failures with exponential backoff and releases the lease", async () => {
    registerJobHandler("test_retry", async (job) => ({
      jobId: job.id,
      success: false,
      status: "failed_retryable",
      retryable: true,
      error: "temporary",
    }));
    const job = makeJob({ job_type: "test_retry", status: "running", attempt_count: 1, lease_until: new Date(Date.now() + 1000).toISOString() });
    db.jobs.push(job);

    await processJob(job, db);
    expect(db.jobs[0].status).toBe("failed_retryable");
    expect(db.jobs[0].lease_until).toBeNull();
    expect(Date.parse(db.jobs[0].scheduled_for)).toBeGreaterThan(Date.now() + 100_000);
  });

  it("fails terminally when retries are exhausted", async () => {
    registerJobHandler("test_exhausted", async (job) => ({
      jobId: job.id,
      success: false,
      status: "failed_retryable",
      retryable: true,
      error: "still failing",
    }));
    const job = makeJob({ job_type: "test_exhausted", status: "running", attempt_count: 3, max_attempts: 3 });
    db.jobs.push(job);

    await processJob(job, db);
    expect(db.jobs[0].status).toBe("failed_terminal");
  });

  it("fails an unknown job type terminally", async () => {
    const job = makeJob({ job_type: "does_not_exist", status: "running", attempt_count: 1 });
    db.jobs.push(job);
    const res = await processJob(job, db);
    expect(res.status).toBe("failed_terminal");
    expect(db.jobs[0].status).toBe("failed_terminal");
  });

  it("moves an unconfirmed outcome to needs_reconciliation and never retries it", async () => {
    registerJobHandler("test_unconfirmed", async (job) => ({
      jobId: job.id,
      success: false,
      status: "needs_reconciliation",
      retryable: false,
      error: "not confirmed",
    }));
    const job = makeJob({ job_type: "test_unconfirmed", status: "running", attempt_count: 1 });
    db.jobs.push(job);
    await processJob(job, db);
    expect(db.jobs[0].status).toBe("needs_reconciliation");
    expect(await claimDueJobs({ limit: 5 }, db)).toHaveLength(0);
  });

  it("executes only one handler for duplicate deliveries of the same running lease", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const handler = vi.fn(async (job: AgentJob) => {
      await gate;
      return { jobId: job.id, success: true, status: "succeeded" as const, retryable: false };
    });
    registerJobHandler("test_duplicate_delivery", handler);
    const job = makeJob({
      job_type: "test_duplicate_delivery",
      status: "running",
      attempt_count: 1,
    });
    db.jobs.push({ ...job });

    const first = processJob(job, db);
    const duplicate = processJob(job, db);
    await Promise.resolve();
    release();
    await Promise.all([first, duplicate]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(db.attempts).toHaveLength(1);
    expect(db.jobs[0].status).toBe("succeeded");
  });

  it("does not finalize a job when durable attempt history cannot be recorded", async () => {
    registerJobHandler("test_attempt_log_failure", async (job) => ({
      jobId: job.id,
      success: true,
      status: "succeeded",
      retryable: false,
    }));
    const job = makeJob({ job_type: "test_attempt_log_failure", status: "running", attempt_count: 1 });
    db.jobs.push(job);
    db.opts.failAttemptInsert = true;

    await expect(processJob(job, db)).rejects.toThrow("Failed to record attempt");
    expect(db.jobs[0].status).toBe("running");
    expect(db.attempts).toHaveLength(0);
  });

  it("never reports success when the database write fails", async () => {
    registerJobHandler("test_dbfail", async (job) => ({
      jobId: job.id,
      success: true,
      status: "succeeded",
      retryable: false,
    }));
    const job = makeJob({ job_type: "test_dbfail", status: "running", attempt_count: 1 });
    db.jobs.push(job);
    db.opts.failJobUpdates = true;

    await expect(processJob(job, db)).rejects.toThrow(JobTransitionError);
    expect(db.jobs[0].status).toBe("running");
  });

  it("fails closed for a publish job whose post does not exist, and records attempt history", async () => {
    db.tables.workspaces.push({ id: "ws-test", entitlement_type: "publishing_beta", paused_at: null });
    const job = makeJob({ status: "running", attempt_count: 1, payload: { postId: "post-123" } });
    db.jobs.push(job);

    const res = await processJob(job, db);
    expect(res.success).toBe(false);
    expect(res.status).toBe("failed_terminal");
    expect(db.jobs[0].status).toBe("failed_terminal");
    expect(db.attempts).toHaveLength(1);
  });
});

describe("reconcileStaleJobs", () => {
  let db: MockSupabase;
  const expired = () => new Date(Date.now() - 60_000).toISOString();
  beforeEach(() => {
    db = new MockSupabase();
  });

  it("re-queues a stale non-publish job for retry", async () => {
    db.jobs.push(makeJob({ job_type: "other", status: "running", attempt_count: 1, lease_until: expired() }));
    expect(await reconcileStaleJobs(db)).toBe(1);
    expect(db.jobs[0].status).toBe("failed_retryable");
    expect(db.jobs[0].lease_until).toBeNull();
  });

  it("fails a stale job terminally when attempts are used up", async () => {
    db.jobs.push(makeJob({ job_type: "other", status: "running", attempt_count: 3, max_attempts: 3, lease_until: expired() }));
    await reconcileStaleJobs(db);
    expect(db.jobs[0].status).toBe("failed_terminal");
  });

  it("does NOT retry a publish job whose post was already 'publishing' (could double-post)", async () => {
    db.jobs.push(makeJob({ status: "running", attempt_count: 1, lease_until: expired(), payload: { postId: "p1" } }));
    db.posts.push({ id: "p1", workspace_id: "ws-test", status: "publishing" });

    expect(await reconcileStaleJobs(db)).toBe(1);
    expect(db.jobs[0].status).toBe("needs_reconciliation");
    expect(db.posts[0].status).toBe("needs_reconciliation");
  });

  it("retries a stale publish job whose post never reached 'publishing'", async () => {
    db.jobs.push(makeJob({ status: "running", attempt_count: 1, lease_until: expired(), payload: { postId: "p2" } }));
    db.posts.push({ id: "p2", workspace_id: "ws-test", status: "scheduled" });

    await reconcileStaleJobs(db);
    expect(db.jobs[0].status).toBe("failed_retryable");
    expect(db.posts[0].status).toBe("scheduled");
  });

  it("leaves jobs with an active lease alone", async () => {
    db.jobs.push(makeJob({ job_type: "other", status: "running", lease_until: new Date(Date.now() + 60_000).toISOString() }));
    expect(await reconcileStaleJobs(db)).toBe(0);
    expect(db.jobs[0].status).toBe("running");
  });
});
