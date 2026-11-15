import { afterEach, describe, expect, it, vi } from "vitest";
import { GroqProvider } from "./groq";

describe("GroqProvider model discovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("ignores a retired configured model and selects a supported production model", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: "llama-3.3-70b-versatile" },
        { id: "openai/gpt-oss-120b" },
        { id: "openai/gpt-oss-20b" },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GroqProvider("test-key", "llama-3.3-70b-versatile");
    await expect(provider.resolveModel()).resolves.toBe("openai/gpt-oss-120b");
  });

  it("moves to the next supported model after the active model fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: "openai/gpt-oss-120b" },
        { id: "openai/gpt-oss-20b" },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GroqProvider("test-key");
    await expect(provider.resolveModel()).resolves.toBe("openai/gpt-oss-120b");
    await expect(provider.resolveModel(true, "openai/gpt-oss-120b")).resolves.toBe("openai/gpt-oss-20b");
  });

  it("never selects arbitrary unsupported models returned by the account", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "llama-3.3-70b-versatile" }, { id: "whisper-large-v3" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GroqProvider("test-key", "llama-3.3-70b-versatile");
    await expect(provider.resolveModel()).rejects.toThrow(/no supported production groq text model/i);
  });
});
