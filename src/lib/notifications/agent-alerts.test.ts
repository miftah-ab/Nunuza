import { describe, expect, it, vi } from "vitest";
import { agentSkipNotice, linkedInExpiryNotice, notifyAgentSkip, createLinkedInExpiryNotifications } from "./agent-alerts";
import { isCoveredByTelegramDraftMessage } from "./dispatcher";

const NOW = Date.parse("2026-11-16T00:00:00Z");
const inDays = (days: number) => new Date(NOW + days * 86_400_000).toISOString();

describe("agent skip notices", () => {
  it("explains actionable reasons and ignores routine ones", () => {
    expect(agentSkipNotice("autopilot_linkedin_connection_or_scope_unavailable")?.priority).toBe("critical");
    expect(agentSkipNotice("weekly_cadence_already_met")).toBeNull();
    expect(agentSkipNotice(undefined)).toBeNull();
  });

  it("uses one event key per reason per week", async () => {
    const rpc = vi.fn(async () => ({}));
    await notifyAgentSkip({ rpc }, "w", "monthly_draft_limit_reached", "2026-11-16");
    await notifyAgentSkip({ rpc }, "w", "monthly_draft_limit_reached", "2026-11-17");
    const keys = rpc.mock.calls.map((call: any[]) => call[1].p_event_key);
    expect(keys[0]).toBe(keys[1]);
    await notifyAgentSkip({ rpc }, "w", "weekly_cadence_already_met", "2026-11-16");
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe("LinkedIn expiry warnings", () => {
  it("warns at 7, 3 and 1 days, not earlier", () => {
    expect(linkedInExpiryNotice(inDays(10), NOW)).toBeNull();
    expect(linkedInExpiryNotice(inDays(6.5), NOW)?.key).toContain(":7");
    expect(linkedInExpiryNotice(inDays(2.5), NOW)?.key).toContain(":3");
    const last = linkedInExpiryNotice(inDays(0.5), NOW);
    expect(last?.key).toContain(":1");
    expect(last?.priority).toBe("critical");
  });

  it("reports an expired connection", () => {
    expect(linkedInExpiryNotice(inDays(-1), NOW)?.title).toBe("LinkedIn connection expired");
  });

  it("creates events for connections inside the window", async () => {
    const rpc = vi.fn(async () => ({}));
    const chain: any = {};
    for (const m of ["select", "eq", "not", "lte", "gte"]) chain[m] = () => chain;
    chain.limit = async () => ({ data: [{ workspace_id: "w", expires_at: inDays(2) }], error: null });
    await createLinkedInExpiryNotifications({ from: () => chain, rpc }, NOW);
    expect(rpc).toHaveBeenCalledWith("create_notification_event", expect.objectContaining({ p_workspace_id: "w", p_category: "integration" }));
  });
});

describe("telegram duplicate suppression", () => {
  it("skips the generic text where an image message already exists", () => {
    expect(isCoveredByTelegramDraftMessage("A post is ready for your approval")).toBe(true);
    expect(isCoveredByTelegramDraftMessage("Your post is scheduled")).toBe(true);
    expect(isCoveredByTelegramDraftMessage("Your post was published")).toBe(false);
  });
});
