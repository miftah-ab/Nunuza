import { describe, expect, it } from "vitest";
import { resolveOpenRouterModel } from "./openrouter";

describe("resolveOpenRouterModel", () => {
  it("defaults to a paid general-purpose model instead of openrouter/free", () => {
    expect(resolveOpenRouterModel()).toBe("google/gemma-4-31b-it");
    expect(resolveOpenRouterModel("openrouter/free")).toBe("google/gemma-4-31b-it");
  });

  it("rejects free model variants that may require user-data collection", () => {
    expect(resolveOpenRouterModel("google/gemma-4-31b-it:free")).toBe("google/gemma-4-31b-it");
    expect(resolveOpenRouterModel("google/gemma-4-26b-a4b-it:free")).toBe("google/gemma-4-31b-it");
  });

  it("preserves an explicitly configured paid model", () => {
    expect(resolveOpenRouterModel("google/gemma-4-26b-a4b-it")).toBe("google/gemma-4-26b-a4b-it");
  });
});
