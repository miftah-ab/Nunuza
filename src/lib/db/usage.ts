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

interface DraftUsagePeriod {
  periodStart: string;
  periodEnd: string;
  metric: string;
  resetsOn: string;
}

/**
 * Resolve the quota window from verified server-side workspace/subscription
 * records. Paid workspaces use the exact Polar billing-cycle start as part of
 * the metric key; draft-only and beta workspaces use UTC calendar months.
 */
export async function getDraftUsagePeriod(
  workspaceId: string,
  ownerUserId: string,
  supabaseOverride?: any
): Promise<DraftUsagePeriod> {
  const supabase = supabaseOverride ?? createServiceClient();
  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("entitlement_type")
    .eq("id", workspaceId)
    .eq("owner_user_id", ownerUserId)
    .single();

  if (workspaceError || !workspace) {
    throw new Error("[usage] Could not verify workspace entitlement for draft quota.");
  }

  if (workspace.entitlement_type === "paid_trial" || workspace.entitlement_type === "paid_active") {
    const { data: subscription, error: subscriptionError } = await supabase
      .from("subscriptions")
      .select("current_period_start, current_period_end, trial_start, trial_end")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (subscriptionError || !subscription) {
      throw new Error("[usage] Verified billing period is unavailable. Draft creation is temporarily blocked.");
    }

    const startValue = subscription.current_period_start ??
      (workspace.entitlement_type === "paid_trial" ? subscription.trial_start : null);
    const endValue = subscription.current_period_end ??
      (workspace.entitlement_type === "paid_trial" ? subscription.trial_end : null);
    const start = startValue ? new Date(startValue) : null;
    const end = endValue ? new Date(endValue) : null;
    const now = Date.now();

    if (
      !start || !end ||
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end.getTime() <= start.getTime() ||
      now < start.getTime() ||
      now >= end.getTime()
    ) {
      throw new Error("[usage] Verified billing period is invalid or expired. Draft creation is temporarily blocked.");
    }

    return {
      periodStart: start.toISOString().slice(0, 10),
      periodEnd: end.toISOString().slice(0, 10),
      metric: `${DRAFT_ITEMS_METRIC}@${start.toISOString()}`,
      resetsOn: end.toISOString().slice(0, 10),
    };
  }

  const { periodStart, periodEnd } = getCalendarMonthPeriod();
  const now = new Date();
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    periodStart,
    periodEnd,
    metric: DRAFT_ITEMS_METRIC,
    resetsOn: nextMonth.toISOString().slice(0, 10),
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
export async function checkDraftLimit(workspaceId: string, ownerUserId?: string): Promise<DraftLimitStatus> {
  const supabase = createServiceClient();
  let count = 0;
  let resetsOn: string;

  if (ownerUserId) {
    const period = await getDraftUsagePeriod(workspaceId, ownerUserId);
    const { data, error } = await supabase.rpc("get_draft_usage_status", {
      p_workspace_id: workspaceId,
      p_owner_user_id: ownerUserId,
      p_period_start: period.periodStart,
      p_metric: period.metric,
    });
    if (error) throw new Error(`[usage] checkDraftLimit: ${error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    count = Number(row?.used_count ?? 0) + Number(row?.reserved_count ?? 0);
    resetsOn = period.resetsOn;
  } else {
    const { periodStart } = getCalendarMonthPeriod();
    const { data, error } = await supabase
      .from("usage_counters")
      .select("count")
      .eq("workspace_id", workspaceId)
      .eq("metric", DRAFT_ITEMS_METRIC)
      .eq("period_start", periodStart)
      .maybeSingle();
    if (error) throw new Error(`[usage] checkDraftLimit: ${error.message}`);
    count = Number(data?.count ?? 0);
    const now = new Date();
    resetsOn = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
      .toISOString().split("T")[0];
  }

  return {
    count,
    limit: MONTHLY_DRAFT_LIMIT,
    isAtLimit: count >= MONTHLY_DRAFT_LIMIT,
    resetsOn,
  };
}

export interface DraftUsageReservation {
  reservationId: string;
  count: number;
  limit: number;
  resetsOn: string;
}

export async function reserveDraftUsage(
  workspaceId: string,
  ownerUserId: string
): Promise<DraftUsageReservation | null> {
  const supabase = createServiceClient();
  const period = await getDraftUsagePeriod(workspaceId, ownerUserId);
  const { data, error } = await supabase.rpc("reserve_draft_usage_slot", {
    p_workspace_id: workspaceId,
    p_owner_user_id: ownerUserId,
    p_period_start: period.periodStart,
    p_period_end: period.periodEnd,
    p_limit: MONTHLY_DRAFT_LIMIT,
    p_metric: period.metric,
  });
  if (error) throw new Error(`[usage] reserveDraftUsage: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.allowed || typeof row.reservation_id !== "string") return null;

  return {
    reservationId: row.reservation_id,
    count: Number(row.current_count),
    limit: MONTHLY_DRAFT_LIMIT,
    resetsOn: period.resetsOn,
  };
}

export async function createDraftWithUsage(
  reservationId: string,
  workspaceId: string,
  ownerUserId: string,
  input: { text: string; internal_title?: string | null; pillar?: string | null; source_notes?: string | null },
  status: "draft" | "needs_review" = "draft"
) {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("create_draft_with_usage", {
    p_reservation_id: reservationId,
    p_workspace_id: workspaceId,
    p_owner_user_id: ownerUserId,
    p_text: input.text,
    p_internal_title: input.internal_title ?? null,
    p_pillar: input.pillar ?? null,
    p_source_notes: input.source_notes ?? null,
    p_status: status,
  });
  if (error) throw new Error(`[usage] createDraftWithUsage: ${error.message}`);
  const post = Array.isArray(data) ? data[0] : data;
  if (!post || typeof post !== "object" || !("id" in post)) {
    throw new Error("[usage] Draft creation did not return a persisted post.");
  }
  return post as import("@/types/database").ContentPost;
}

export async function releaseDraftUsage(
  reservationId: string,
  workspaceId: string,
  ownerUserId: string
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.rpc("release_draft_usage_slot", {
    p_reservation_id: reservationId,
    p_workspace_id: workspaceId,
    p_owner_user_id: ownerUserId,
  });
  if (error) throw new Error(`[usage] releaseDraftUsage: ${error.message}`);
}

/**
 * Limits private Voice preview generation without consuming a draft slot.
 * The existing usage_counters table and atomic RPC are reused; no migration
 * or new metric table is required. The metric key rolls over each UTC hour.
 */
export async function consumeVoiceTestAllowance(workspaceId: string): Promise<boolean> {
  const supabase = createServiceClient();
  const now = new Date();
  const periodStart = now.toISOString().slice(0, 10);
  const hourKey = now.toISOString().slice(0, 13).replace(/[-T:]/g, "");
  const { data, error } = await supabase.rpc("increment_usage_counter", {
    p_workspace_id: workspaceId,
    p_metric: "voice_test:" + hourKey,
    p_period_start: periodStart,
    p_period_end: periodStart,
  });
  if (error) throw new Error("[usage] consumeVoiceTestAllowance: " + error.message);
  const count = Number(data);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("[usage] Voice preview allowance could not be verified.");
  }
  return count <= 5;
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
    throw new Error(`[usage] incrementDraftCounter: ${error.message}`);
  }
  const count = Number(data);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("[usage] Draft usage counter could not be verified.");
  }
  return count;
}
