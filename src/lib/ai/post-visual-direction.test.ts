import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPostVisualImagePrompt,
  createPostVisualBrief,
  VisualPlanningError,
  type PostVisualBrief,
} from "./post-visual-direction";

const originalApiKey = process.env.OPENROUTER_API_KEY;

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
  if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalApiKey;
});

function providerResponse(brief: PostVisualBrief) {
  return new Response(JSON.stringify({
    model: "free-model",
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(brief) } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("post visual art direction", () => {
  it("does not silently create a generic title-based brief when the free AI key is missing", async () => {
    delete process.env.OPENROUTER_API_KEY;

    await expect(createPostVisualBrief(post)).rejects.toBeInstanceOf(VisualPlanningError);
  });

  it("uses Gemma 4 31B first and returns a detailed art-direction brief", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    const fetchMock = vi.fn().mockResolvedValue(providerResponse(validBrief));
    vi.stubGlobal("fetch", fetchMock);

    const brief = await createPostVisualBrief(post);

    expect(brief).toEqual(validBrief);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("google/gemma-4-31b-it:free");
    expect(body.max_tokens).toBe(1600);
    expect(body.response_format).toBeUndefined();
    expect(body.provider.data_collection).toBe("deny");
    expect(body.messages[1].content).toContain("FULL POST BODY");
    expect(body.messages[1].content).toContain("The goal is not to be seen by everyone");
  });

  it("falls back to Gemma 4 26B when the primary free model is unavailable", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(providerResponse(validBrief));
    vi.stubGlobal("fetch", fetchMock);

    const brief = await createPostVisualBrief(post);

    expect(brief).toEqual(validBrief);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body));
    expect(secondBody.model).toBe("google/gemma-4-26b-a4b-it:free");
    expect(secondBody.response_format.json_schema.strict).toBe(true);
    expect(secondBody.provider.data_collection).toBe("deny");
  });

  it("uses the third free model when both primary routes are unavailable", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("temporarily unavailable", { status: 503 }))
      .mockResolvedValueOnce(providerResponse(validBrief));
    vi.stubGlobal("fetch", fetchMock);

    const brief = await createPostVisualBrief(post);

    expect(brief).toEqual(validBrief);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const thirdBody = JSON.parse(String((fetchMock.mock.calls[2] as [string, RequestInit])[1].body));
    expect(thirdBody.model).toBe("baidu/ernie-5.5-flash-preview:free");
    expect(thirdBody.response_format.json_schema.strict).toBe(true);
    expect(thirdBody.provider.data_collection).toBe("deny");
  });

  it("fails instead of generating from a generic fallback when all free planners fail", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 })));

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
