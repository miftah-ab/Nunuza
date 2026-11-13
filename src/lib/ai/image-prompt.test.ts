import { describe, expect, it } from "vitest";
import { buildImagePrompt } from "./image-prompt";

const post = {
  internal_title: "Why operational debt slows teams",
  text: "Small shortcuts compound into operational debt and slow product teams.",
};

describe("buildImagePrompt", () => {
  it("defaults to non-human objects and explicitly blocks random people", () => {
    const prompt = buildImagePrompt(post);
    expect(prompt).toContain("Do NOT show a person");
    expect(prompt).toContain("random person standing in an office");
    expect(prompt).toContain("Why operational debt slows teams");
  });

  it("supports explicit people mode without generic stock-photo direction", () => {
    const prompt = buildImagePrompt(post, "A founder explaining a prototype", "cinematic", "people");
    expect(prompt).toContain("Human subjects are allowed");
    expect(prompt).toContain("A founder explaining a prototype");
    expect(prompt).toContain("ART DIRECTION: Cinematic documentary still");
  });

  it("supports abstract concepts without people", () => {
    const prompt = buildImagePrompt(post, undefined, "illustration", "abstract");
    expect(prompt).toContain("non-human conceptual visual metaphor");
    expect(prompt).toContain("Do NOT show people");
    expect(prompt).toContain("Sophisticated conceptual editorial illustration");
  });
});
