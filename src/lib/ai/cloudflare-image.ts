/**
 * Cloudflare Workers AI image generation client.
 *
 * Server-only: credentials never reach browser code. Uses the documented
 * JSON REST API for Leonardo Lucid Origin on both Vercel and OpenNext.
 */

export const CLOUDFLARE_IMAGE_MODEL = "@cf/leonardo/lucid-origin";
export const MAX_GENERATED_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_GUIDANCE = 7;
const IMAGE_STEPS = 28;

export class CloudflareImageError extends Error {
  readonly code: "not_configured" | "invalid_prompt" | "provider_error" | "invalid_image";
  readonly status: number;

  constructor(code: CloudflareImageError["code"], message: string, status = 502) {
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

export interface ImageDimensions {
  width: number;
  height: number;
}

export async function generateCloudflareImage(
  prompt: string,
  dimensions: ImageDimensions = { width: 1024, height: 1280 },
  fetcher: typeof fetch = fetch
): Promise<GeneratedImage> {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt || normalizedPrompt.length > 6000) {
    throw new CloudflareImageError(
      "invalid_prompt",
      "Please keep your image description between 1 and 6,000 characters.",
      400
    );
  }

  const allowedDimensions = new Set(["1024x1280", "1280x720", "1024x1024"]);
  if (!allowedDimensions.has(`${dimensions.width}x${dimensions.height}`)) {
    throw new CloudflareImageError("invalid_prompt", "Choose a supported image size.", 400);
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !apiToken) {
    console.error("[image-generation] Provider credentials are unavailable.");
    throw new CloudflareImageError(
      "not_configured",
      "Image creation is temporarily unavailable. Please try again later.",
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
        body: JSON.stringify({
          prompt: normalizedPrompt,
          width: dimensions.width,
          height: dimensions.height,
          guidance: IMAGE_GUIDANCE,
          num_steps: IMAGE_STEPS,
        }),
        signal: AbortSignal.timeout(55_000),
      }
    );
  } catch (error) {
    console.error("[image-generation] Provider request failed:", error);
    throw new CloudflareImageError(
      "provider_error",
      "We couldn’t reach the image service. Please try again.",
      502
    );
  }

  if (!response.ok) {
    throw new CloudflareImageError(
      "provider_error",
      response.status === 429
        ? "Image creation is busy right now. Please try again in a little while."
        : "We couldn’t create your image this time. Please try again.",
      response.status === 429 ? 429 : 502
    );
  }

  let payload: CloudflareImageResponse;
  try {
    payload = (await response.json()) as CloudflareImageResponse;
  } catch {
    throw new CloudflareImageError("invalid_image", "We couldn’t process the image response. Please try again.");
  }

  const base64 = payload.result?.image ?? payload.image;
  if (payload.success === false || typeof base64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new CloudflareImageError("invalid_image", "We couldn’t create a usable image. Please try again.");
  }

  let bytes: Uint8Array;
  try {
    const binary = atob(base64);
    if (binary.length === 0 || binary.length > MAX_GENERATED_IMAGE_BYTES) {
      throw new Error("Image size is outside the allowed limit.");
    }
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new CloudflareImageError(
      "invalid_image",
      "The image couldn’t be created because it was too large or invalid. Please try again."
    );
  }

  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new CloudflareImageError(
      "invalid_image",
      "The image format isn’t supported. Please try again."
    );
  }

  return { bytes, contentType: "image/jpeg", model: CLOUDFLARE_IMAGE_MODEL };
}
