/**
 * Customer-facing notices about the agent itself: why it did not post, and
 * when LinkedIn access is about to run out. Both reuse the durable
 * notification pipeline (inbox, push, Telegram), and both are idempotent per
 * event key so the same problem is reported once, not on every cycle.
 */

const DAY_MS = 86_400_000;

interface AgentNotice { title: string; body: string; href: string; priority: "high" | "critical" }

const SKIP_NOTICES: Record<string, AgentNotice> = {
  autopilot_linkedin_connection_or_scope_unavailable: {
    title: "Autopilot paused: reconnect LinkedIn",
    body: "Nunuza could not post today because your LinkedIn connection is missing or expired. Reconnect it and Autopilot continues on its own.",
    href: "/app/integrations", priority: "critical",
  },
  monthly_draft_limit_reached: {
    title: "Monthly draft limit reached",
    body: "Nunuza has used this month's drafts, so it will not write new posts until the limit resets.",
    href: "/app/billing", priority: "high",
  },
  insufficient_business_context: {
    title: "Nunuza needs more about your business",
    body: "Your strategy has no pillars, goals or audience yet, so Nunuza has nothing to research. Add them and it will start.",
    href: "/app/strategy", priority: "high",
  },
  drafts_waiting_for_review: {
    title: "Nunuza paused new drafts: you have drafts waiting",
    body: "You have drafts waiting for review, so Nunuza did not write a new one today. Approve or reject them and it carries on. Drafts older than 7 days are cleared automatically.",
    href: "/app/content", priority: "high",
  },
  all_candidates_excluded_by_brand: {
    title: "Everything Nunuza found is on your exclusion list",
    body: "Today's stories all matched your exclusions, so nothing was posted. Review your exclusions if this keeps happening.",
    href: "/app/strategy", priority: "high",
  },
};

export function agentSkipNotice(reason: unknown): AgentNotice | null {
  return typeof reason === "string" ? SKIP_NOTICES[reason] ?? null : null;
}

function weekKey(cycleDate: string): number {
  const time = Date.parse(cycleDate + "T00:00:00Z");
  return Number.isNaN(time) ? 0 : Math.floor(time / (7 * DAY_MS));
}

/** One notice per reason per week. Never throws. */
export async function notifyAgentSkip(db: any, workspaceId: string, reason: unknown, cycleDate: string): Promise<void> {
  const notice = agentSkipNotice(reason);
  if (!notice) return;
  try {
    await db.rpc("create_notification_event", {
      p_workspace_id: workspaceId,
      p_event_key: `agent-skip:${String(reason)}:${weekKey(cycleDate)}`,
      p_category: "agent", p_priority: notice.priority,
      p_title: notice.title, p_body: notice.body, p_href: notice.href,
    });
  } catch (error) {
    console.error("[agent-alerts] Could not record skip notice:", error instanceof Error ? error.message : "unknown");
  }
}

export function linkedInExpiryNotice(expiresAt: string, now = Date.now()):
  { key: string; title: string; body: string; priority: "high" | "critical" } | null {
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) return null;
  const msLeft = expiry - now;
  if (msLeft <= 0) {
    return {
      key: `linkedin-expired:${expiresAt}`, priority: "critical",
      title: "LinkedIn connection expired",
      body: "Nunuza can no longer post to LinkedIn. Reconnect it to resume.",
    };
  }
  const daysLeft = Math.ceil(msLeft / DAY_MS);
  const bucket = [1, 3, 7].find((limit) => daysLeft <= limit);
  if (!bucket) return null;
  return {
    key: `linkedin-expiry:${expiresAt}:${bucket}`, priority: bucket === 1 ? "critical" : "high",
    title: bucket === 1 ? "LinkedIn connection expires within a day" : `LinkedIn connection expires in ${daysLeft} days`,
    body: "LinkedIn access lasts 60 days and cannot be renewed in the background. Reconnect before it ends so Autopilot keeps posting.",
  };
}

/** Warns at 7, 3 and 1 days, and once after expiry. Never throws. */
export async function createLinkedInExpiryNotifications(db: any, now = Date.now()): Promise<void> {
  try {
    const { data, error } = await db.from("integration_connections")
      .select("workspace_id, expires_at")
      .eq("provider", "linkedin").eq("status", "connected")
      .not("expires_at", "is", null)
      .lte("expires_at", new Date(now + 7 * DAY_MS).toISOString())
      .gte("expires_at", new Date(now - 3 * DAY_MS).toISOString())
      .limit(200);
    if (error) return;
    for (const row of data ?? []) {
      const notice = linkedInExpiryNotice(row.expires_at, now);
      if (!notice) continue;
      await db.rpc("create_notification_event", {
        p_workspace_id: row.workspace_id, p_event_key: notice.key,
        p_category: "integration", p_priority: notice.priority,
        p_title: notice.title, p_body: notice.body, p_href: "/app/integrations",
      });
    }
  } catch (error) {
    console.error("[agent-alerts] LinkedIn expiry pass failed:", error instanceof Error ? error.message : "unknown");
  }
}
