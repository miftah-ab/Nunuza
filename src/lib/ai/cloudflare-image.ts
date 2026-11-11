/**
 * Cloudflare Workers AI image generation client.
 *
 * Server-only: Cloudflare credentials must never reach browser code.
 * Uses the documented Workers AI REST endpoint so the same implementation
 * works on both Vercel-hosted Next.js and the Cloudflare OpenNext Worker.
 */

export const CLOUDFLARE_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
export const MAX_GENERATED_IMAGE_BYTES = 5 * 1024 * 1024;

export class CloudflareImageError extends Error {
  readonly code: "not_configured" | "invalid_prompt" | "provider_error" | "invalid_image";
  readonly status: number;

  constructor(
    code: CloudflareImageError["code"],
    message: string,
    status = 502
  ) {
    super(message);
    this.name = "CloudflareImageError";
    this.code = code;
    this.status = status;
  }
}

export interface GeneratedImage {
  bytes: Uint8Array;
  contentType: "image/jpeg";
  model: typeof CLOUDFLARE_IMAGE_MODEL;
}

interface CloudflareImageResponse {
  success?: boolean;
  result?: { image?: string };
  image?: string;
}

export async function generateCloudflareImage(
  prompt: string,
  fetcher: typeof fetch = fetch
): Promise<GeneratedImage> {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt || normalizedPrompt.length > 2048) {
    throw new CloudflareImageError(
      "invalid_prompt",
      "Image prompt must contain between 1 and 2,048 characters.",
      400
    );
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !apiToken) {
    throw new CloudflareImageError(
      "not_configured",
      "Image generation is not configured. Add the Cloudflare Workers AI credentials.",
      503
    );
  }

  let response: Response;
  try {
    response = await fetcher(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${CLOUDFLARE_IMAGE_MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: normalizedPrompt, steps: 4 }),
        signal: AbortSignal.timeout(90_000),
      }
    );
  } catch {
    throw new CloudflareImageError(
      "provider_error",
      "Cloudflare image generation could not be reached. Please retry.",
      502
    );
  }

  if (!response.ok) {
    // Do not return upstream response bodies; they may contain provider details.
    throw new CloudflareImageError(
      "provider_error",
      response.status === 429
        ? "Cloudflare image generation is rate-limited. Please retry later."
        : "Cloudflare image generation failed. Please retry.",
      response.status === 429 ? 429 : 502
    );
  }

  let payload: CloudflareImageResponse;
  try {
    payload = (await response.json()) as CloudflareImageResponse;
  } catch {
    throw new CloudflareImageError(
      "invalid_image",
      "Cloudflare returned an unreadable image response."
    );
  }

  const base64 = payload.result?.image ?? payload.image;
  if (payload.success === false || typeof base64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new CloudflareImageError(
      "invalid_image",
      "Cloudflare did not return a valid generated image."
    );
  }

  let bytes: Uint8Array;
  try {
    const binary = atob(base64);
    if (binary.length === 0 || binary.length > MAX_GENERATED_IMAGE_BYTES) {
      throw new Error("Image size out of bounds");
    }
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new CloudflareImageError(
      "invalid_image",
      "The generated image was invalid or exceeded the 5 MB limit."
    );
  }

  // FLUX.1 Schnell returns JPEG. Reject unexpected formats before storage.
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new CloudflareImageError(
      "invalid_image",
      "Cloudflare returned an unsupported image format."
    );
  }

  return { bytes, contentType: "image/jpeg", model: CLOUDFLARE_IMAGE_MODEL };
}
