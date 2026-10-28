/**
 * Usage limit enforcement.
 *
 * Spec §12: Up to 30 new draft items per calendar month.
 * Hard cap, visible to user, no overages, no overrides.
 *
 * This module provides:
 * - checkDraftLimit: returns current count + whether limit is reached
 * - incrementDraftCounter: atomically increments the monthly counter
 * - getDraftCounterPeriod: returns the current billing period start/end dates
 *
 * These are called server-side only, never from client components.
 * The limit check is enforced at the API layer, not just in the UI.
 */

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum new draft items per calendar month. Spec §12, spec §16. Cannot be overridden. */
export const MONTHLY_DRAFT_LIMIT = 30;

/** Metric key used in usage_counters table */
const DRAFT_ITEMS_METRIC = "draft_items_created";

// ─── Period helpers ───────────────────────────────────────────────────────────

/** Returns ISO date strings for the first and last day of the given month */
export function getCalendarMonthPeriod(date: Date = new Date()): {
  periodStart: string;
  periodEnd: string;
} {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth(); // 0-indexed

  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 0)); // last day of month

  return {
    periodStart: start.toISOString().split("T")[0],
    periodEnd:   end.toISOString().split("T")[0],
  };
}

// ─── Limit check ─────────────────────────────────────────────────────────────

export interface DraftLimitStatus {
  /** Current count of drafts created this calendar month */
  count: number;
  /** Maximum allowed. Always MONTHLY_DRAFT_LIMIT. */
  limit: number;
  /** True if count >= limit — creation must be blocked */
  isAtLimit: boolean;
  /** ISO date the counter resets (first day of next month) */
  resetsOn: string;
}

/**
 * Returns the current draft creation usage for this workspace/month.
 * Does NOT block — caller decides whether to proceed based on isAtLimit.
 */
export async function checkDraftLimit(workspaceId: string): Promise<DraftLimitStatus> {
  const supabase = await createClient();
  const { periodStart, periodEnd } = getCalendarMonthPeriod();

  const { data, error } = await supabase
    .from("usage_counters")
    .select("count")
    .eq("workspace_id", workspaceId)
    .eq("metric", DRAFT_ITEMS_METRIC)
    .eq("period_start", periodStart)
    .maybeSingle();

  if (error) throw new Error(`[usage] checkDraftLimit: ${error.message}`);

  const count = data?.count ?? 0;

  // Calculate reset date (first day of next month)
  const now = new Date();
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const resetsOn = nextMonth.toISOString().split("T")[0];

  return {
    count,
    limit: MONTHLY_DRAFT_LIMIT,
    isAtLimit: count >= MONTHLY_DRAFT_LIMIT,
    resetsOn,
  };
}

/**
 * Atomically increments the monthly draft counter for a workspace.
 * Uses UPSERT with an atomic increment to prevent race conditions.
 * Returns the new count after increment.
 *
 * Call AFTER successfully creating the draft post in the DB.
 * Uses the service client for atomic upsert (bypasses RLS for counter management).
 */
export async function incrementDraftCounter(workspaceId: string): Promise<number> {
  // Use service client for atomic upsert — usage_counters is not client-writable
  const supabase = createServiceClient();
  const { periodStart, periodEnd } = getCalendarMonthPeriod();

  const { data, error } = await supabase.rpc("increment_usage_counter", {
    p_workspace_id: workspaceId,
    p_metric:       DRAFT_ITEMS_METRIC,
    p_period_start: periodStart,
    p_period_end:   periodEnd,
  });

  if (error) {
    // Log but don't throw — counter failure should not fail the post creation
    console.error(`[usage] incrementDraftCounter: ${error.message}`);
    return -1;
  }

  return (data as number) ?? -1;
}
