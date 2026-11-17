/**
 * Plain-language result of the latest agent cycle. A cycle that "succeeded"
 * but created nothing must not read as a success on the dashboard.
 */

export interface CycleOutcome { label: string; detail: string; tone: "success" | "warning" | "muted" }

const SKIPPED: Record<string, string> = {
  weekly_cadence_already_met: "You already have this week's posts going out, so no new post was needed.",
  drafts_waiting_for_review: "You have drafts waiting for review, so no new draft was written. Review them to keep the agent going.",
  autopilot_linkedin_connection_or_scope_unavailable: "LinkedIn is not connected or has expired. Reconnect it so Autopilot can post.",
  monthly_draft_limit_reached: "This month's draft limit is used up.",
  insufficient_business_context: "Your strategy needs pillars, goals or an audience before Nunuza can research.",
  all_candidates_excluded_by_brand: "Every story found matched your exclusion list.",
  no_fresh_research: "No usable news was found, and no evergreen topic was available.",
};

export function describeCycleOutcome(decision: unknown, reason: unknown): CycleOutcome | null {
  if (decision === "queue_autopilot_publish") {
    return { label: "Post scheduled", detail: "The agent wrote a post and scheduled it. You can stop it before it goes out.", tone: "success" };
  }
  if (decision === "create_review_draft") {
    return { label: "Draft ready for review", detail: "The agent wrote a draft and is waiting for your approval.", tone: "success" };
  }
  if (decision === "research_unavailable") {
    return { label: "Ran without news", detail: "News sources could not be reached, so the agent used an evergreen topic for review.", tone: "warning" };
  }
  if (decision === "no_op") {
    const detail = typeof reason === "string" && SKIPPED[reason] ? SKIPPED[reason] : "No new post was created this time.";
    return { label: "Ran, nothing new created", detail, tone: "warning" };
  }
  return null;
}
