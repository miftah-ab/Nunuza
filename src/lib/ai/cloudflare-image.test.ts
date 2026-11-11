import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CloudflareImageError,
  CLOUDFLARE_IMAGE_MODEL,
  generateCloudflareImage,
} from "./cloudflare-image";

const jpegBase64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2w==";

describe("Cloudflare Workers AI image generation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires server-side Cloudflare credentials", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
    await expect(generateCloudflareImage("A professional editorial image")).rejects.toMatchObject({
      code: "not_configured",
      status: 503,
    });
  });

  it("calls FLUX.1 Schnell and decodes the returned JPEG", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "account-id");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "secret-token");
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: { image: jpegBase64 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const result = await generateCloudflareImage("A professional editorial image", fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      `https://api.cloudflare.com/client/v4/accounts/account-id/ai/run/${CLOUDFLARE_IMAGE_MODEL}`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer secret-token" }),
      })
    );
    expect(result.contentType).toBe("image/jpeg");
    expect(result.bytes[0]).toBe(0xff);
    expect(result.bytes[1]).toBe(0xd8);
  });

  it("rejects malformed image responses", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "account-id");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "secret-token");
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: { image: "not-base64" },
    }), { status: 200 }));
    await expect(generateCloudflareImage("valid prompt", fetcher)).rejects.toBeInstanceOf(CloudflareImageError);
  });

  it("maps provider rate limits without leaking response bodies", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "account-id");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "secret-token");
    const fetcher = vi.fn().mockResolvedValue(new Response("sensitive upstream detail", { status: 429 }));
    await expect(generateCloudflareImage("valid prompt", fetcher)).rejects.toMatchObject({
      code: "provider_error",
      status: 429,
      message: "Cloudflare image generation is rate-limited. Please retry later.",
    });
  });

  it("rejects empty and oversized prompts", async () => {
    await expect(generateCloudflareImage("   ", vi.fn())).rejects.toMatchObject({ code: "invalid_prompt" });
    await expect(generateCloudflareImage("x".repeat(2049), vi.fn())).rejects.toMatchObject({ code: "invalid_prompt" });
  });
});
