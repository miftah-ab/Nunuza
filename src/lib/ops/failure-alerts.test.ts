import { describe, expect, it, vi } from "vitest";
import { alertFailedJobs, buildFailureAlert, selectUnalerted, type FailedJobRow } from "./failure-alerts";

const job = (over: Partial<FailedJobRow> = {}): FailedJobRow => ({
  id: "11111111-2222-3333-4444-555555555555",
  workspace_id: "w1",
  job_type: "agent_cycle",
  safe_error_message: "Could not verify monthly draft usage.",
  last_error_code: "TERMINAL_ERROR",
  finished_at: "2026-11-15T00:03:37Z",
  ...over,
});

describe("failure alerts", () => {
  it("names the job, workspace and reason without customer content", () => {
    const text = buildFailureAlert(job(), "Miftah Mobile's Workspace");
    expect(text).toContain("agent_cycle");
    expect(text).toContain("Miftah Mobile's Workspace");
    expect(text).toContain("Could not verify monthly draft usage.");
    expect(text).toContain("11111111");
    expect(text).not.toContain("555555555555");
  });

  it("skips jobs that were already alerted and caps each pass", () => {
    const failed = Array.from({ length: 8 }, (_, i) => job({ id: `job-${i}`, finished_at: `2026-11-15T00:0${i}:00Z` }));
    const picked = selectUnalerted(failed, new Set(["job-0"]), 5);
    expect(picked.map((j) => j.id)).toEqual(["job-1", "job-2", "job-3", "job-4", "job-5"]);
  });

  it("does nothing and never queries when no ops chat is configured", async () => {
    vi.stubEnv("OPS_ALERT_TELEGRAM_CHAT_ID", "");
    const from = vi.fn();
    const result = await alertFailedJobs({ from });
    expect(result.sent).toBe(0);
    expect(from).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
