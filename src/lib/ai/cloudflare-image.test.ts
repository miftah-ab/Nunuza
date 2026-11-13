import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CloudflareImageError,
  CLOUDFLARE_IMAGE_MODEL,
  generateCloudflareImage,
} from "./cloudflare-image";

const jpegBase64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2w==";

describe("Cloudflare Workers AI image generation", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("requires server-side Cloudflare credentials", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
    await expect(generateCloudflareImage("A professional editorial image")).rejects.toMatchObject({
      code: "not_configured",
      status: 503,
    });
  });

  it("calls free-allocation FLUX.2 Klein 4B using multipart form data and decodes the returned JPEG", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "account-id");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "secret-token");
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: { image: jpegBase64 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const result = await generateCloudflareImage("A premium editorial image", { width: 1280, height: 720 }, fetcher);
    const [, request] = fetcher.mock.calls[0] as [string, RequestInit];
    const form = request.body as FormData;

    expect(fetcher).toHaveBeenCalledWith(
      `https://api.cloudflare.com/client/v4/accounts/account-id/ai/run/${CLOUDFLARE_IMAGE_MODEL}`,
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer secret-token" },
      })
    );
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("prompt")).toBe("A premium editorial image");
    expect(form.get("width")).toBe("1280");
    expect(form.get("height")).toBe("720");
    expect(form.get("guidance")).toBe("3.5");
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
    await expect(generateCloudflareImage("valid prompt", undefined, fetcher)).rejects.toBeInstanceOf(CloudflareImageError);
  });

  it("maps provider rate limits without leaking response bodies", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "account-id");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "secret-token");
    const fetcher = vi.fn().mockResolvedValue(new Response("sensitive upstream detail", { status: 429 }));
    await expect(generateCloudflareImage("valid prompt", undefined, fetcher)).rejects.toMatchObject({
      code: "provider_error",
      status: 429,
      message: "The free image-generation allowance or service capacity has been reached. Please try again after it resets.",
    });
  });

  it("rejects empty, oversized, and unsupported-size requests before calling the provider", async () => {
    const fetcher = vi.fn();
    await expect(generateCloudflareImage("   ", undefined, fetcher)).rejects.toMatchObject({ code: "invalid_prompt" });
    await expect(generateCloudflareImage("x".repeat(6001), undefined, fetcher)).rejects.toMatchObject({ code: "invalid_prompt" });
    await expect(generateCloudflareImage("valid", { width: 512, height: 512 }, fetcher)).rejects.toMatchObject({ code: "invalid_prompt" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
