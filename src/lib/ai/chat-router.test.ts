import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRoutedMessage, routeTelegramMessage } from "./chat-router";

describe("parseRoutedMessage", () => {
  it("parses chat, create and revise", () => {
    expect(parseRoutedMessage('{"intent":"chat","reply":"Hi!","topic":""}', false)).toEqual({ intent: "chat", reply: "Hi!", topic: "" });
    expect(parseRoutedMessage('{"intent":"create","reply":"","topic":"hiring"}', false)?.intent).toBe("create");
    expect(parseRoutedMessage('{"intent":"revise","reply":"","topic":""}', true)?.intent).toBe("revise");
  });
  it("never revises without an open draft", () => {
    expect(parseRoutedMessage('{"intent":"revise"}', false)?.intent).toBe("chat");
  });
  it("tolerates text around the JSON and rejects junk", () => {
    expect(parseRoutedMessage('Sure: {"intent":"create","topic":"x"} done', false)?.intent).toBe("create");
    expect(parseRoutedMessage("no json", false)).toBeNull();
    expect(parseRoutedMessage('{"intent":"delete"}', false)).toBeNull();
    expect(parseRoutedMessage('{"intent":"chat","reply":""}', false)).toBeNull();
  });
});

describe("routeTelegramMessage", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("returns null when no provider is configured", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(await routeTelegramMessage({ text: "hi" })).toBeNull();
  });

  it("uses OpenRouter and returns the routed intent", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-test");
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"intent":"chat","reply":"Hello! What would you like to post about?"}' } }] }), { status: 200 })
    ) as unknown as typeof fetch;
    const routed = await routeTelegramMessage({ text: "hey", fetchImpl });
    expect(routed?.intent).toBe("chat");
    expect(routed?.reply).toContain("Hello");
  });

  it("returns null on provider errors so the caller can fall back", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-test");
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 500 })) as unknown as typeof fetch;
    expect(await routeTelegramMessage({ text: "hey", fetchImpl })).toBeNull();
  });
});
