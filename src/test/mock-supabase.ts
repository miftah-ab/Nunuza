/**
 * Small in-memory Supabase stand-in for unit tests.
 *
 * Supports the query shapes the job runner and publisher use:
 *   from(t).select().eq().in().neq().gte().lt().lte().single()/maybeSingle()
 *   from(t).update(patch).eq().in().select()   (compare-and-set style)
 *   from(t).insert(row)
 *   rpc("claim_due_agent_jobs", args)           (emulates the SQL function's contract)
 *
 * It is a contract test double: it proves the application's behaviour given the
 * database's documented semantics. True row-locking behaviour of the SQL function is
 * exercised separately against real Postgres (see the db-concurrency CI job).
 */

export interface MockDbOptions {
  failJobUpdates?: boolean;
  failAttemptInsert?: boolean;
  /** Fail post updates whose patch matches (simulates a failed save after a LinkedIn publish). */
  failPostUpdateWhen?: (patch: Record<string, any>) => boolean;
  rpcError?: string | null;
}

type Row = Record<string, any>;

export class MockSupabase {
  tables: Record<string, Row[]> = {
    agent_jobs: [],
    agent_job_attempts: [],
    content_posts: [],
    workspaces: [],
    audit_events: [],
  };
  opts: MockDbOptions;
  /** Every update attempted, as "table:status" strings, for assertions. */
  updateLog: string[] = [];

  constructor(opts: MockDbOptions = {}) {
    this.opts = opts;
  }

  get jobs() {
    return this.tables.agent_jobs;
  }
  get posts() {
    return this.tables.content_posts;
  }
  get attempts() {
    return this.tables.agent_job_attempts;
  }

  rpc(name: string, args: any) {
    if (this.opts.rpcError) {
      return Promise.resolve({ data: null, error: { message: this.opts.rpcError } });
    }
    if (name === "begin_agent_job_execution") {
      const target = this.jobs.find((candidate) => candidate.id === args.p_job_id);
      const expected = args.p_expected_lease_until;
      const valid = !!target &&
        target.status === "running" &&
        target.attempt_count === args.p_attempt_count &&
        target.lease_until === expected &&
        Date.parse(target.lease_until) > Date.now();
      if (valid) {
        target.lease_until = args.p_new_lease_until;
      }
      return Promise.resolve({ data: valid, error: null });
    }
    if (name === "claim_workspace_publish_slot") {
      const now = Date.now();
      const target = this.posts.find((post) =>
        post.id === args.p_post_id && post.workspace_id === args.p_workspace_id
      );
      if (!target || !["approved", "scheduled"].includes(target.status)) {
        return Promise.resolve({ data: [{ allowed: false, reason: "POST_NOT_ELIGIBLE" }], error: null });
      }
      const dayStart = new Date(now);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = dayStart.getTime() + 86400000;
      const weekStart = now - 7 * 86400000;
      const timestampFor = (post: Row) => {
        if (post.status === "published") return Date.parse(post.published_at ?? "");
        if (post.status === "scheduled") return Date.parse(post.scheduled_at ?? "");
        return Date.parse(post.updated_at ?? post.created_at ?? "");
      };
      const inDailyWindow = (post: Row) => {
        const stamp = timestampFor(post);
        return Number.isFinite(stamp) && stamp >= dayStart.getTime() && stamp < dayEnd;
      };
      const inWeeklyWindow = (post: Row) => {
        const stamp = timestampFor(post);
        return Number.isFinite(stamp) && stamp >= weekStart && stamp <= now + 7 * 86400000;
      };
      const others = this.posts.filter((post) =>
        post.workspace_id === args.p_workspace_id && post.id !== args.p_post_id
      );
      const daily = others.filter((post) =>
        ["published", "scheduled", "publishing", "needs_reconciliation"].includes(post.status) && inDailyWindow(post)
      ).length;
      if (daily >= 1) {
        return Promise.resolve({ data: [{ allowed: false, reason: "DAILY_CAP_REACHED" }], error: null });
      }
      const weekly = others.filter((post) =>
        ["published", "scheduled", "publishing", "needs_reconciliation"].includes(post.status) && inWeeklyWindow(post)
      ).length;
      if (weekly >= 7) {
        return Promise.resolve({ data: [{ allowed: false, reason: "WEEKLY_CAP_REACHED" }], error: null });
      }
      Object.assign(target, { status: "publishing", updated_at: new Date(now).toISOString() });
      return Promise.resolve({ data: [{ allowed: true, reason: null }], error: null });
    }
    if (name !== "claim_due_agent_jobs") {
      return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
    }
    const now = Date.now();
    const types: string[] | null = args.p_job_types ?? null;
    const isDue = (j: Row) =>
      ["queued", "failed_retryable"].includes(j.status) &&
      Date.parse(j.scheduled_for) <= now &&
      (!j.lease_until || Date.parse(j.lease_until) <= now) &&
      (!types || types.includes(j.job_type));

    // Exhausted jobs are terminalized, not claimed.
    this.jobs
      .filter((j) => isDue(j) && j.attempt_count >= j.max_attempts)
      .forEach((j) =>
        Object.assign(j, {
          status: "failed_terminal",
          last_error_code: "MAX_ATTEMPTS_EXCEEDED",
          safe_error_message: "Max retry attempts exceeded.",
        })
      );

    // Runs synchronously, like one SQL statement: no interleaving between workers.
    const claimed = this.jobs
      .filter((j) => isDue(j) && j.attempt_count < j.max_attempts)
      .sort((a, b) => Date.parse(a.scheduled_for) - Date.parse(b.scheduled_for))
      .slice(0, args.p_limit);

    claimed.forEach((j) =>
      Object.assign(j, {
        status: "running",
        started_at: new Date(now).toISOString(),
        lease_until: new Date(now + args.p_lease_seconds * 1000).toISOString(),
        attempt_count: j.attempt_count + 1,
      })
    );
    return Promise.resolve({ data: claimed.map((j) => ({ ...j })), error: null });
  }

  from(table: string) {
    const db = this;
    const rows = (): Row[] => (db.tables[table] ??= []);

    const query = (mode: "select" | "update", updates?: Row) => {
      const filters: Array<(r: Row) => boolean> = [];
      let returning = mode === "select";

      const run = () => {
        if (
          mode === "update" &&
          ((table === "agent_jobs" && db.opts.failJobUpdates) ||
            (table === "content_posts" && db.opts.failPostUpdateWhen?.(updates ?? {})))
        ) {
          return { data: null, error: { message: "simulated database failure" } };
        }
        const matched = rows().filter((r) => filters.every((f) => f(r)));
        if (mode === "update") {
          matched.forEach((r) => Object.assign(r, updates));
          db.updateLog.push(`${table}:${updates?.status ?? "-"}`);
        }
        return { data: returning ? matched.map((r) => ({ ...r })) : null, error: null };
      };

      const chain: any = {
        eq(c: string, v: any) {
          filters.push((r) => r[c] === v);
          return chain;
        },
        neq(c: string, v: any) {
          filters.push((r) => r[c] !== v);
          return chain;
        },
        in(c: string, vs: any[]) {
          filters.push((r) => vs.includes(r[c]));
          return chain;
        },
        lt(c: string, v: any) {
          filters.push((r) => r[c] != null && r[c] < v);
          return chain;
        },
        lte(c: string, v: any) {
          filters.push((r) => r[c] != null && r[c] <= v);
          return chain;
        },
        gte(c: string, v: any) {
          filters.push((r) => r[c] != null && r[c] >= v);
          return chain;
        },
        select() {
          returning = true;
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        async single() {
          const res = run();
          const first = res.data?.[0];
          return first
            ? { data: first, error: null }
            : { data: null, error: res.error ?? { message: "Row not found" } };
        },
        async maybeSingle() {
          const res = run();
          return { data: res.data?.[0] ?? null, error: res.error };
        },
        then(resolve: any, reject: any) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      return chain;
    };

    return {
      select: (_fields?: string) => query("select"),
      update: (updates: Row) => query("update", updates),
      insert: (row: Row | Row[]) => {
        if (table === "agent_job_attempts" && db.opts.failAttemptInsert) {
          return Promise.resolve({ data: null, error: { message: "simulated attempt insert failure" } });
        }
        const arr = Array.isArray(row) ? row : [row];
        rows().push(...arr);
        return Promise.resolve({ data: arr, error: null });
      },
    };
  }
}

export function makeJob(overrides: Row = {}): any {
  const status = overrides.status ?? "queued";
  return {
    id: "job-1",
    workspace_id: "ws-test",
    job_type: "publish_post",
    status,
    idempotency_key: "key-1",
    payload: {},
    scheduled_for: new Date(Date.now() - 10_000).toISOString(),
    started_at: null,
    finished_at: null,
    attempt_count: 0,
    max_attempts: 3,
    lease_until: status === "running" ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null,
    correlation_id: "corr-1",
    last_error_code: null,
    safe_error_message: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}
