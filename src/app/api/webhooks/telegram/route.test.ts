import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import {
  verifyTelegramSecret,
  claimTelegramWebhookUpdate,
  completeTelegramWebhookUpdate,
  failTelegramWebhookUpdate,
  handleTelegramMessage,
  handleCallbackQuery,
  sendTelegramMessage,
} from "@/lib/integrations/telegram/service";

vi.mock("@/lib/integrations/telegram/service", () => ({
  verifyTelegramSecret: vi.fn(),
  claimTelegramWebhookUpdate: vi.fn(),
  completeTelegramWebhookUpdate: vi.fn(),
  failTelegramWebhookUpdate: vi.fn(),
  handleTelegramMessage: vi.fn(),
  handleCallbackQuery: vi.fn(),
  sendTelegramMessage: vi.fn(),
  registerBotCommands: vi.fn(),
}));

function request(body: unknown) {
  return new Request("https://nunuza.example/api/webhooks/telegram", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": "test-secret",
    },
    body: JSON.stringify(body),
  });
}

describe("Telegram webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyTelegramSecret).mockReturnValue(true);
    vi.mocked(claimTelegramWebhookUpdate).mockResolvedValue("claimed");
    vi.mocked(completeTelegramWebhookUpdate).mockResolvedValue(undefined);
    vi.mocked(failTelegramWebhookUpdate).mockResolvedValue();
    vi.mocked(handleTelegramMessage).mockResolvedValue({ replyText: "Hello" });
    vi.mocked(sendTelegramMessage).mockResolvedValue({ ok: true });
  });

  it("rejects requests with an invalid webhook secret", async () => {
    vi.mocked(verifyTelegramSecret).mockReturnValue(false);
    const response = await POST(request({ update_id: 1 }) as never);
    expect(response.status).toBe(401);
    expect(claimTelegramWebhookUpdate).not.toHaveBeenCalled();
  });

  it("acknowledges completed duplicate updates without replaying commands", async () => {
    vi.mocked(claimTelegramWebhookUpdate).mockResolvedValue("completed");
    const response = await POST(request({ update_id: 2 }) as never);
    expect(response.status).toBe(200);
    expect(handleTelegramMessage).not.toHaveBeenCalled();
    expect(completeTelegramWebhookUpdate).not.toHaveBeenCalled();
  });

  it("asks Telegram to retry an update already being processed", async () => {
    vi.mocked(claimTelegramWebhookUpdate).mockResolvedValue("processing");
    const response = await POST(request({ update_id: 3 }) as never);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("3");
    expect(handleTelegramMessage).not.toHaveBeenCalled();
  });

  it("never dispatches group messages into a workspace", async () => {
    const response = await POST(request({
      update_id: 4,
      message: { from: { id: 10 }, chat: { id: -20, type: "group" }, text: "/drafts" },
    }) as never);
    expect(response.status).toBe(200);
    expect(handleTelegramMessage).not.toHaveBeenCalled();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(completeTelegramWebhookUpdate).toHaveBeenCalledWith(4);
  });

  it("dispatches private messages with explicit private-chat context", async () => {
    const response = await POST(request({
      update_id: 5,
      message: { from: { id: 10 }, chat: { id: 10, type: "private" }, text: "/status" },
    }) as never);
    expect(response.status).toBe(200);
    expect(handleTelegramMessage).toHaveBeenCalledWith({
      telegramUserId: 10,
      chatId: 10,
      chatType: "private",
      updateId: 5,
      text: "/status",
    });
    expect(sendTelegramMessage).toHaveBeenCalledWith(10, "Hello", undefined);
    expect(completeTelegramWebhookUpdate).toHaveBeenCalledWith(5);
  });

  it("releases failed updates and returns a retryable HTTP response", async () => {
    vi.mocked(handleTelegramMessage).mockRejectedValue(new Error("database unavailable"));
    const response = await POST(request({
      update_id: 6,
      message: { from: { id: 10 }, chat: { id: 10, type: "private" }, text: "/pause" },
    }) as never);
    expect(response.status).toBe(500);
    expect(failTelegramWebhookUpdate).toHaveBeenCalledWith(6);
    expect(completeTelegramWebhookUpdate).not.toHaveBeenCalled();
  });

  it("does not dispatch callback actions from group chats", async () => {
    const response = await POST(request({
      update_id: 7,
      callback_query: {
        id: "callback-1",
        from: { id: 10 },
        data: "agent:pause",
        message: { message_id: 2, chat: { id: -20, type: "supergroup" } },
      },
    }) as never);
    expect(response.status).toBe(200);
    expect(handleCallbackQuery).not.toHaveBeenCalled();
    expect(completeTelegramWebhookUpdate).toHaveBeenCalledWith(7);
  });
});
