import { describe, expect, it } from "vitest";
import { classifyTelegramDeliveryError } from "./dispatcher";

describe("classifyTelegramDeliveryError", () => {
  it.each([
    "Bad Request: chat not found",
    "Forbidden: bot was blocked by the user",
    "Forbidden: user is deactivated",
    "Forbidden: bot can't initiate conversation with a user",
    "Forbidden: bot was kicked from the group chat",
  ])("classifies permanent Telegram link failures: %s", (message) => {
    expect(classifyTelegramDeliveryError(message)).toBe("permanent_link");
  });

  it.each([
    "Telegram bot is not configured.",
    "Unauthorized",
    "Invalid bot token",
  ])("classifies Telegram configuration failures: %s", (message) => {
    expect(classifyTelegramDeliveryError(message)).toBe("configuration");
  });

  it.each([
    "Telegram API request failed.",
    "fetch failed",
    "Gateway timeout",
    undefined,
  ])("retries transient Telegram failures: %s", (message) => {
    expect(classifyTelegramDeliveryError(message)).toBe("transient");
  });
});
