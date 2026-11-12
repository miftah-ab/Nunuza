import { describe, expect, it } from "vitest";
import { safeJobErrorMessage } from "./error-message";

describe("safeJobErrorMessage", () => {
  it("hides provider and database diagnostics from customer-facing activity", () => {
    const message = safeJobErrorMessage("Cloudflare Workers AI failed: Supabase database error: connection refused");
    expect(message).toContain("Nunuza couldn’t complete this task");
    expect(message).not.toContain("Cloudflare");
    expect(message).not.toContain("Supabase");
  });

  it("preserves useful customer-facing explanations", () => {
    expect(safeJobErrorMessage("Your LinkedIn connection has expired. Please reconnect."))
      .toBe("Your LinkedIn connection has expired. Please reconnect.");
  });
});
