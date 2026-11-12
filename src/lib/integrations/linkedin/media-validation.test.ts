import { describe, expect, it } from "vitest";
import { validateLinkedInMedia } from "./media-validation";

describe("validateLinkedInMedia", () => {
  it("accepts an organic image post with 2 image slides", () => {
    expect(validateLinkedInMedia("image_carousel", [
      { mediaType: "image", mimeType: "image/jpeg" },
      { mediaType: "image", mimeType: "image/png" },
    ])).toBeNull();
  });

  it("accepts the maximum of 20 image slides", () => {
    const slides = Array.from({ length: 20 }, () => ({ mediaType: "image" as const, mimeType: "image/png" }));
    expect(validateLinkedInMedia("image_carousel", slides)).toBeNull();
  });

  it("rejects image carousels with fewer than 2 or more than 20 slides", () => {
    expect(validateLinkedInMedia("image_carousel", [
      { mediaType: "image", mimeType: "image/jpeg" },
    ])).toContain("2–20");
    const tooMany = Array.from({ length: 21 }, () => ({ mediaType: "image" as const, mimeType: "image/png" }));
    expect(validateLinkedInMedia("image_carousel", tooMany)).toContain("2–20");
  });

  it("rejects mixed or non-image carousel assets", () => {
    expect(validateLinkedInMedia("image_carousel", [
      { mediaType: "image", mimeType: "image/png" },
      { mediaType: "document", mimeType: "application/pdf" },
    ])).toContain("JPG or PNG");
  });

  it("accepts exactly one PDF document", () => {
    expect(validateLinkedInMedia("document", [
      { mediaType: "document", mimeType: "application/pdf" },
    ])).toBeNull();
  });

  it("rejects multiple documents and non-PDF document assets", () => {
    expect(validateLinkedInMedia("document", [
      { mediaType: "document", mimeType: "application/pdf" },
      { mediaType: "document", mimeType: "application/pdf" },
    ])).toContain("one PDF");
    expect(validateLinkedInMedia("document", [
      { mediaType: "document", mimeType: "image/png" },
    ])).toContain("one PDF");
  });
});
