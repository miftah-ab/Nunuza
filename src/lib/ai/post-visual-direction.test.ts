import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPostVisualImagePrompt,
  createPostVisualBrief,
  type PostVisualBrief,
} from "./post-visual-direction";

const originalApiKey = process.env.OPENROUTER_API_KEY;

const post = {
  internal_title: "Why customer onboarding fails",
  text: "Most customers do not churn because the product is missing features. They churn because the first useful outcome takes too long to reach. Reduce the time between signup and the first meaningful result.",
};

const validBrief: PostVisualBrief = {
  concept: "Show the gap between signup and the first useful customer outcome.",
  subject: "A new customer moving through a clear onboarding path toward a first result.",
  metaphor: "A short, visible bridge from signup to value.",
  composition: "One clear path leading from foreground to a bright, concrete outcome.",
  palette: "Deep navy, warm white, and a restrained teal accent.",
  mood: "Clear, focused, and optimistic.",
  avoid: ["Generic office meetings", "Unrelated charts"],
};

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalApiKey;
});

describe("post visual direction", () => {
  it("uses a post-grounded fallback when no OpenRouter key is configured", async () => {
    delete process.env.OPENROUTER_API_KEY;

    const brief = await createPostVisualBrief(post);

    expect(brief.concept).toContain("Why customer onboarding fails");
    expect(brief.subject).toContain("Why customer onboarding fails");
    expect(brief.composition).toContain("focal subject");
  });

  it("uses the pinned free model and parses a valid structured response", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        model: "dots-studio/dots-3-note-preview:free",
        choices: [{
          finish_reason: "stop",
          message: { content: JSON.stringify(validBrief) },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const brief = await createPostVisualBrief(post);

    expect(brief).toEqual(validBrief);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("dots-studio/dots-3-note-preview:free");
    expect(body.max_tokens).toBe(1600);
    expect(body.reasoning.effort).toBe("minimal");
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  it("falls back instead of failing when the provider is rate-limited or unavailable", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("rate limited", { status: 429 })
    ));

    const brief = await createPostVisualBrief(post);

    expect(brief.concept).toContain("Why customer onboarding fails");
    expect(brief.subject).toContain("Why customer onboarding fails");
  });

  it("falls back when the provider consumes its output budget without returning content", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        model: "dots-studio/dots-3-note-preview:free",
        usage: {
          completion_tokens: 1600,
          completion_tokens_details: { reasoning_tokens: 1600 },
        },
        choices: [{ finish_reason: "length", message: { content: "" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    ));

    const brief = await createPostVisualBrief(post);

    expect(brief.concept).toContain("Why customer onboarding fails");
  });

  it("keeps the original post context and user direction in the final image prompt", () => {
    const prompt = buildPostVisualImagePrompt(
      post,
      validBrief,
      "Premium editorial photography",
      "Use a close-up perspective"
    );

    expect(prompt).toContain("Reduce the time between signup");
    expect(prompt).toContain("Use a close-up perspective");
    expect(prompt).toContain(validBrief.subject);
  });
});
