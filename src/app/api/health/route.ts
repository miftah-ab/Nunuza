import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** A queued job overdue by more than this means the worker is not draining. */
const STALL_MINUTES = 20;

/**
 * Liveness and readiness probe for uptime monitoring.
 * Returns 200 only when the database answers and the job queue is draining.
 * The body reports pass/fail per check and never exposes data or errors.
 */
/** The probe is public, so a burst of requests reuses one recent result. */
const CACHE_MS = 15_000;
let cached: { at: number; ok: boolean; checks: { database: boolean; jobs: boolean } } | null = null;

export async function GET() {
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return NextResponse.json(
      { status: cached.ok ? "ok" : "degraded", checks: cached.checks },
      { status: cached.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } }
    );
  }
  const checks = { database: false, jobs: false };
  try {
    const supabase = createServiceClient();
    const probe = await supabase.from("agent_jobs").select("id").limit(1);
    checks.database = !probe.error;

    if (checks.database) {
      const cutoff = new Date(Date.now() - STALL_MINUTES * 60_000).toISOString();
      const overdue = await supabase
        .from("agent_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "queued")
        .lt("scheduled_for", cutoff);
      checks.jobs = !overdue.error && (overdue.count ?? 0) === 0;
    }
  } catch {
    // Any failure leaves the checks false.
  }

  const ok = checks.database && checks.jobs;
  cached = { at: Date.now(), ok, checks };
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", checks },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
