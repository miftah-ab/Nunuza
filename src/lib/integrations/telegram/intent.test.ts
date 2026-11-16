import { describe, expect, it } from "vitest";
import { classifyTelegramIntent as c } from "./intent";

describe("classifyTelegramIntent", () => {
  it("never drafts from greetings, thanks or small talk", () => {
    for (const t of ["hi", "Hello!", "hey there", "thanks", "thank you so much!", "ok", "👍", "lol", "how are you", "what can you do", "good morning", "test"]) {
      expect(c(t, false), t).toBe("chitchat");
      expect(c(t, true), t).toBe("chitchat");
    }
  });

  it("answers questions instead of drafting", () => {
    for (const t of ["what is this?", "how does scheduling work", "can you publish it today?", "why did it fail", "Is my post live?"]) {
      expect(c(t, false), t).toBe("question");
    }
  });

  it("creates a draft for explicit requests", () => {
    for (const t of ["write a post about hiring remote engineers", "draft a LinkedIn post on pricing", "create me a post about AI", "post about my product launch", "new post about leadership"]) {
      expect(c(t, false), t).toBe("create");
      expect(c(t, true), t).toBe("create");
    }
  });

  it("creates a draft from a substantive idea but asks about a fragment", () => {
    expect(c("Our team cut onboarding from two weeks to three days by deleting half the checklist", false)).toBe("create");
    expect(c("remote hiring", false)).toBe("vague");
    expect(c("pricing", false)).toBe("vague");
  });

  it("treats edit wording as a revision when a draft is open", () => {
    for (const t of ["make it short", "make it shorter", "shorten it", "rewrite the opening", "add a practical example", "too long", "I don't like this opening", "can you make it punchier?"]) {
      expect(c(t, true), t).toBe("revise");
    }
  });

  it("does not revise when there is no draft", () => {
    expect(c("make it short", false)).toBe("vague");
  });

  it("asks before treating a long message with an open draft as an edit", () => {
    expect(c("We launched a new onboarding flow last week and customers finished setup twice as fast as before", true)).toBe("vague");
  });
});
