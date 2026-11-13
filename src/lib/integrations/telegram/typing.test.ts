import { afterEach, describe, expect, it, vi } from "vitest";
import { withTelegramTyping } from "./typing";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("withTelegramTyping", () => {
  it("does not block work when Telegram's typing endpoint never responds", async () => {
    const neverResponds = new Promise<Response>(() => {});
    const fetchMock = vi.fn().mockReturnValue(neverResponds);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      withTelegramTyping(12345, async () => "job completed")
    ).resolves.toBe("job completed");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
