import { describe, expect, it } from "vitest";
import { userFacingError } from "./error-message";

describe("userFacingError", () => {
  it("keeps useful customer-facing messages", () => {
    expect(userFacingError(new Error("Your post was saved."), "Try again."))
      .toBe("Your post was saved.");
  });

  it("hides browser and infrastructure diagnostics", () => {
    expect(userFacingError(new TypeError("Failed to fetch"), "We couldn’t save your post."))
      .toBe("We couldn’t save your post.");
    expect(userFacingError(new Error("Cloudflare Workers AI credentials missing"), "Try again later."))
      .toBe("Try again later.");
  });

  it("uses the fallback for unknown error values", () => {
    expect(userFacingError({ message: "raw error" }, "Please try again."))
      .toBe("Please try again.");
  });
});
