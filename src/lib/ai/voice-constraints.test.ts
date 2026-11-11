import { describe, expect, it } from "vitest";
import {
  assertVoiceConstraints,
  findVoiceConstraintConflict,
  VoiceConstraintError,
} from "./voice-constraints";

describe("voice profile constraints", () => {
  it("matches forbidden phrases without case sensitivity", () => {
    expect(findVoiceConstraintConflict("A GAME-CHANGER for teams", {
      phrasesAvoid: ["game-changer"],
    })).toBe("game-changer");
  });

  it("normalizes repeated whitespace before matching", () => {
    expect(findVoiceConstraintConflict("Avoid this   topic today", {
      exclusions: ["this topic"],
    })).toBe("this topic");
  });

  it("does not match a short exclusion inside a larger word", () => {
    expect(findVoiceConstraintConflict("A paid product for founders", {
      phrasesAvoid: ["AI"],
    })).toBeNull();
  });

  it("allows content when no forbidden phrase is present", () => {
    expect(findVoiceConstraintConflict("A practical lesson for founders", {
      phrasesAvoid: ["synergy"],
      exclusions: ["politics"],
    })).toBeNull();
  });

  it("does not reject when no voice profile exists", () => {
    expect(() => assertVoiceConstraints("Any topic", undefined)).not.toThrow();
  });

  it("throws a typed error for a direct conflict", () => {
    expect(() => assertVoiceConstraints("We will discuss politics", {
      exclusions: ["politics"],
    })).toThrow(VoiceConstraintError);
  });
});
