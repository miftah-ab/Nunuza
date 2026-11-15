import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPostVisualImagePrompt,
  createPostVisualBrief,
  VisualPlanningError,
  type PostVisualBrief,
} from "./post-visual-direction";

const originalEnv = {
  groqKey: process.env.GROQ_API_KEY,
  openRouterKey: process.env.OPENROUTER_API_KEY,
  groqModel: process.env.GROQ_DEFAULT_MODEL,
  openRouterModel: process.env.OPENROUTER_DEFAULT_MODEL,
};

const post = {
  internal_title: "LinkedIn growth and professional visibility: Key lessons",
  text: "Most professionals treat LinkedIn visibility as a numbers game. They post every day but never give readers a reason to remember them. A clear point of view, repeated through useful examples, builds recognition over time. The goal is not to be seen by everyone; it is to become memorable to the right people.",
};

const validBrief: PostVisualBrief = {
  centralMessage: "Consistent, useful points of view make a professional memorable to the right audience; posting volume alone does not.",
  visualConcept: "A single distinctive signal stands out from a noisy crowd of identical messages.",
  subject: "One sharply focused handwritten field notebook with a distinctive, underlined point of view, surrounded by many identical blank notebooks.",
  action: "A hand places the distinctive notebook at the front of the arrangement while the identical notebooks recede into soft focus.",
  setting: "A restrained contemporary editorial tabletop, not a literal office or social-media workspace.",
  visualDetails: "The featured notebook has tactile paper, a single bold underline, and carefully arranged blank notebooks behind it; no visible brand marks.",
  composition: "Close three-quarter overhead view; the featured notebook fills the foreground and sits off-center, with repeated notebooks forming a subtle rhythm into the background and clean negative space in the upper third.",
  lightingAndPalette: "Directional natural window light, deep ink blue, warm paper white, muted graphite, and restrained amber highlights.",
  textTreatment: "No text in the image. Communicate the idea through the contrast between one distinctive notebook and the identical notebooks.",
  avoid: ["LinkedIn logos or interface screenshots", "Generic people at laptops", "Floating charts and follower counters"],
};

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of [
    ["GROQ_API_KEY", originalEnv.groqKey],
    ["OPENROUTER_API_KEY", originalEnv.openRouterKey],
    ["GROQ_DEFAULT_MODEL", originalEnv.groqModel],
    ["OPENROUTER_DEFAULT_MODEL", originalEnv.openRouterModel],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function modelsResponse() {
  return new Response(JSON.stringify({
    data: [{ id: "openai/gpt-oss-120b" }, { id: "openai/gpt-oss-20b" }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function providerResponse(brief: PostVisualBrief) {
  return new Response(JSON.stringify({
    model: "test-model",
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(brief) } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("post visual art direction", () => {
  it("fails closed when neither privacy-safe AI provider is configured", async () => {
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    await expect(createPostVisualBrief(post)).rejects.toBeInstanceOf(VisualPlanningError);
  });

  it("uses Groq GPT-OSS first with strict JSON Schema and the full post", async () => {
    process.env.GROQ_API_KEY = "test-groq-key";
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(modelsResponse())
      .mockResolvedValueOnce(providerResponse(validBrief));
    vi.stubGlobal("fetch", fetchMock);

    const brief = await createPostVisualBrief(post);

    expect(brief).toEqual(validBrief);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/models");
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("openai/gpt-oss-120b");
    expect(body.max_completion_tokens).toBe(2000);
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].content).toContain("FULL POST BODY");
    expect(body.messages[0].content).toContain("The goal is not to be seen by everyone");
    expect(body.provider).toBeUndefined();
  });

  it("falls back to paid Gemma 4 on OpenRouter without enabling free-model training", async () => {
    process.env.GROQ_API_KEY = "test-groq-key";
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.OPENROUTER_DEFAULT_MODEL = "openrouter/free";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(modelsResponse())
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(providerResponse(validBrief));
    vi.stubGlobal("fetch", fetchMock);

    const brief = await createPostVisualBrief(post);

    expect(brief).toEqual(validBrief);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    const [, init] = fetchMock.mock.calls[2] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("google/gemma-4-31b-it");
    expect(body.model).not.toMatch(/:free$/);
    expect(body.provider.data_collection).toBe("deny");
    expect(body.provider.require_parameters).toBe(true);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[1].content).toContain("FULL POST BODY");
  });

  it("uses paid OpenRouter when Groq is not configured", async () => {
    delete process.env.GROQ_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.OPENROUTER_DEFAULT_MODEL = "openrouter/free";
    const fetchMock = vi.fn().mockResolvedValueOnce(providerResponse(validBrief));
    vi.stubGlobal("fetch", fetchMock);

    const brief = await createPostVisualBrief(post);

    expect(brief).toEqual(validBrief);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("google/gemma-4-31b-it");
    expect(body.provider.data_collection).toBe("deny");
  });

  it("fails instead of generating from a generic fallback when all configured providers fail", async () => {
    process.env.GROQ_API_KEY = "test-groq-key";
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(modelsResponse())
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("temporarily unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createPostVisualBrief(post)).rejects.toThrow(
      "It won’t generate a guess based on the title."
    );
  });

  it("builds an executable image brief with the full source context and text decision", () => {
    const prompt = buildPostVisualImagePrompt(
      post,
      validBrief,
      "Premium editorial photography",
      "Use a closer crop"
    );

    expect(prompt).toContain(validBrief.centralMessage);
    expect(prompt).toContain(validBrief.subject);
    expect(prompt).toContain(validBrief.action);
    expect(prompt).toContain(validBrief.setting);
    expect(prompt).toContain("Do not render any text");
    expect(prompt).toContain("Use a closer crop");
    expect(prompt).toContain("The goal is not to be seen by everyone");
    expect(prompt).toContain("Do not reinterpret the subject");
  });
});
