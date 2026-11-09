import { describe, it, expect, afterEach } from "vitest";
import { encryptToken, decryptToken } from "./crypto";

const VALID_KEY = "a".repeat(64);
const original = process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY;

afterEach(() => {
  if (original === undefined) delete process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY;
  else process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY = original;
});

describe("LinkedIn token encryption key handling", () => {
  it("round-trips a token with a valid 64-hex-char key", () => {
    process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY = VALID_KEY;
    const ref = encryptToken("secret-access-token");
    expect(ref).not.toContain("secret-access-token");
    expect(decryptToken(ref)).toBe("secret-access-token");
  });

  it("fails closed when the key is missing (no public fallback key)", () => {
    delete process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken("x")).toThrow(/LINKEDIN_TOKEN_ENCRYPTION_KEY/);
  });

  it("fails closed when the key is too short or not hex", () => {
    process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY = "short";
    expect(() => encryptToken("x")).toThrow(/LINKEDIN_TOKEN_ENCRYPTION_KEY/);
    process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY = "z".repeat(64);
    expect(() => encryptToken("x")).toThrow(/LINKEDIN_TOKEN_ENCRYPTION_KEY/);
  });
});
