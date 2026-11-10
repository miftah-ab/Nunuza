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
    if (name !== "claim_due_agent_jobs") {
      return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
    }
    if (this.opts.rpcError) {
      return Promise.resolve({ data: null, error: { message: this.opts.rpcError } });
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
        const arr = Array.isArray(row) ? row : [row];
        rows().push(...arr);
        return Promise.resolve({ data: arr, error: null });
      },
    };
  }
}

export function makeJob(overrides: Row = {}): any {
  return {
    id: "job-1",
    workspace_id: "ws-test",
    job_type: "publish_post",
    status: "queued",
    idempotency_key: "key-1",
    payload: {},
    scheduled_for: new Date(Date.now() - 10_000).toISOString(),
    started_at: null,
    finished_at: null,
    attempt_count: 0,
    max_attempts: 3,
    lease_until: null,
    correlation_id: "corr-1",
    last_error_code: null,
    safe_error_message: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}
