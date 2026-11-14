/**
 * POST /api/generate/image — generate and attach a private image to a draft.
 * GET /api/generate/image?postId=... — return a short-lived preview URL.
 *
 * Images are generated on demand, stored privately per workspace, and never
 * published automatically. The LinkedIn publishing pipeline remains separate.
 */

import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { apiError, parseBody } from "@/lib/api/respond";
import { createServiceClient } from "@/lib/supabase/server";
import { getPost } from "@/lib/db/posts";
import { logAuditEvent } from "@/lib/db/workspace";
import { createPostVisualBrief, buildPostVisualImagePrompt, VisualPlanningError, type PostVisualBrief } from "@/lib/ai/post-visual-direction";
import {
  CloudflareImageError,
  CLOUDFLARE_IMAGE_MODEL,
  generateCloudflareImage,
  type ImageDimensions,
} from "@/lib/ai/cloudflare-image";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "nunuza-generated-images";
const STANDARD_HOURLY_IMAGE_LIMIT = 5;
const PRIVATE_BETA_HOURLY_IMAGE_LIMIT = 100;

function getHourlyImageLimit(entitlementType: string): number {
  return entitlementType === "internal_beta"
    ? PRIVATE_BETA_HOURLY_IMAGE_LIMIT
    : STANDARD_HOURLY_IMAGE_LIMIT;
}
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const IMAGE_STYLES = {
  editorial: "Premium editorial photography for a leading business publication. Art-directed, visually specific, tactile details, natural cinematic light, sophisticated color grading, authentic materials, intentional negative space.",
  cinematic: "Cinematic documentary still, dramatic but believable lighting, rich atmospheric depth, strong composition, realistic lens and material detail, restrained color grade, premium film production quality.",
  illustration: "Sophisticated conceptual editorial illustration, distinctive art direction, elegant shapes and textures, restrained palette, clear visual metaphor, polished magazine-cover quality, not childish or clip-art.",
  "3d": "High-end product visualization with physically plausible materials, refined studio lighting, realistic reflections and shadows, precise geometry, premium commercial art direction.",
  minimalist: "Minimalist Swiss-inspired editorial visual, one unmistakable focal object, deliberate negative space, precise geometry, restrained palette, subtle texture, exceptionally clean composition.",
} as const;

type ImageStyle = keyof typeof IMAGE_STYLES;
type ImageFormat = "portrait" | "landscape" | "square";

interface GenerateImageBody {
  action?: "analyze" | "generate";
  postId: string;
  visualBrief?: PostVisualBrief;
  prompt?: string;
  style?: ImageStyle;
  format?: ImageFormat;
}

const IMAGE_DIMENSIONS: Record<ImageFormat, ImageDimensions> = {
  portrait: { width: 1024, height: 1280 },
  landscape: { width: 1280, height: 720 },
  square: { width: 1024, height: 1024 },
};

async function createPreviewUrl(path: string) {
  const service = createServiceClient();
  const { data, error } = await service.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) throw new Error("Could not create a private image preview.");
  return data.signedUrl;
}

export async function GET(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const postId = new URL(request.url).searchParams.get("postId");
    if (!postId || !UUID_PATTERN.test(postId)) {
      return NextResponse.json({ error: "Choose a post before creating an image." }, { status: 400 });
    }

    const post = await getPost(workspace.id, postId);
    if (!post) return NextResponse.json({ error: "We couldn’t find this post. Refresh and try again." }, { status: 404 });
    if (!post.image_path) return NextResponse.json({ data: { imagePath: null, previewUrl: null } });
    if (!post.image_path.startsWith(`${workspace.id}/`)) {
      return NextResponse.json({ error: "This image isn’t available for this post." }, { status: 403 });
    }

    return NextResponse.json({
      data: { imagePath: post.image_path, previewUrl: await createPreviewUrl(post.image_path) },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  let quotaReservation: { service: any; reservationId: string } | null = null;
  let quotaCommitted = false;
  let uploadedPath: string | null = null;
  try {
    const workspace = await requireWorkspace();
    const body = await parseBody<GenerateImageBody>(request);
    if (!body?.postId || !UUID_PATTERN.test(body.postId)) {
      return NextResponse.json({ error: "A valid postId is required." }, { status: 400 });
    }
    if (typeof body.prompt === "string" && body.prompt.length > 1200) {
      return NextResponse.json({ error: "Visual direction must be 1,200 characters or fewer." }, { status: 400 });
    }
    if (body.style !== undefined && !Object.hasOwn(IMAGE_STYLES, body.style)) {
      return NextResponse.json({ error: "Choose a supported visual style." }, { status: 400 });
    }
    if (body.format !== undefined && !Object.hasOwn(IMAGE_DIMENSIONS, body.format)) {
      return NextResponse.json({ error: "Choose a supported image format." }, { status: 400 });
    }

    const post = await getPost(workspace.id, body.postId);
    if (!post) return NextResponse.json({ error: "Post not found." }, { status: 404 });
    if (!["draft", "needs_review", "approved"].includes(post.status)) {
      return NextResponse.json(
        { error: "Images can only be generated for drafts awaiting review or approval." },
        { status: 409 }
      );
    }
    if (!post.text?.trim()) {
      return NextResponse.json({ error: "Add post text before generating an image." }, { status: 422 });
    }

    const style = body.style ?? "editorial";
    const format = body.format ?? "portrait";

    // The agent first interprets the post and proposes a visual direction.
    // Analysis is a lightweight text operation and does not consume image quota.
    const visualBrief = body.action === "analyze" || !body.visualBrief
      ? await createPostVisualBrief(post)
      : body.visualBrief;
    const requiredBriefFields: (keyof Omit<PostVisualBrief, "avoid">)[] = [
      "centralMessage", "visualConcept", "subject", "action", "setting",
      "visualDetails", "composition", "lightingAndPalette", "textTreatment",
    ];
    if (
      JSON.stringify(visualBrief).length > 6_000 ||
      requiredBriefFields.some((field) => typeof visualBrief[field] !== "string" || visualBrief[field].length > 420) ||
      !Array.isArray(visualBrief.avoid) ||
      visualBrief.avoid.length > 6 ||
      visualBrief.avoid.some((item) => typeof item !== "string" || item.length > 420)
    ) {
      return NextResponse.json({ error: "The visual direction is invalid. Analyze the post again." }, { status: 400 });
    }
    if (body.action === "analyze") {
      return NextResponse.json({ data: { visualBrief } });
    }

    const service = createServiceClient();
    const now = new Date();
    const periodStart = now.toISOString().slice(0, 10);
    const hourKey = now.toISOString().slice(0, 13).replace(/[-T:]/g, "");
    const metric = `image_generation:${hourKey}`;
    const hourlyImageLimit = getHourlyImageLimit(workspace.entitlement_type);
    const { data: reservationId, error: usageError } = await service.rpc("reserve_image_generation", {
      p_workspace_id: workspace.id,
      p_metric: metric,
      p_period_start: periodStart,
      p_period_end: periodStart,
      p_limit: hourlyImageLimit,
    });
    if (usageError) throw new Error("Image generation usage could not be verified.");
    if (!reservationId) {
      return NextResponse.json(
        {
          error: workspace.entitlement_type === "internal_beta"
            ? "You’ve used all 100 image generations for this hour. You can create more next hour."
            : "You’ve used all 5 image generations for this hour. You can create more next hour.",
        },
        { status: 429 }
      );
    }
    quotaReservation = { service, reservationId: String(reservationId) };

    const prompt = buildPostVisualImagePrompt(post, visualBrief, IMAGE_STYLES[style], body.prompt);
    const generated = await generateCloudflareImage(prompt, IMAGE_DIMENSIONS[format]);
    const path = `${workspace.id}/${post.id}/${crypto.randomUUID()}.jpg`;

    const { error: uploadError } = await service.storage.from(BUCKET).upload(path, generated.bytes, {
      contentType: generated.contentType,
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadError) throw new Error("Generated image could not be saved. Please retry.");
    uploadedPath = path;

    // Create the preview before attaching the image to the post. If signing
    // fails, cleanup removes the upload and releases the quota reservation.
    const previewUrl = await createPreviewUrl(path);

    // Commit the reserved slot before attaching the image. If the post update
    // fails, the finally block releases this exact reservation idempotently.
    const currentQuotaReservation = quotaReservation;
    if (!currentQuotaReservation) {
      throw new Error("Image generation quota reservation was lost. Please retry.");
    }
    const { data: quotaCommittedResult, error: quotaCommitError } = await service.rpc(
      "commit_image_generation_reservation",
      { p_reservation_id: currentQuotaReservation.reservationId }
    );
    if (quotaCommitError || quotaCommittedResult !== true) {
      throw new Error("Image generation quota could not be committed. Please retry.");
    }

    const { data: updated, error: updateError } = await service
      .from("content_posts")
      .update({
        image_path: path,
        image_prompt: prompt,
        image_model: generated.model,
        image_generated_at: new Date().toISOString(),
        ...(post.status !== "draft" ? { status: "draft" } : {}),
      })
      .eq("id", post.id)
      .eq("workspace_id", workspace.id)
      .in("status", ["draft", "needs_review", "approved"])
      .select("id, image_path, status")
      .single();

    if (updateError || !updated) {
      throw new Error("We couldn’t add the image to your draft. Please try again.");
    }
    quotaCommitted = true;
    uploadedPath = null;

    if (post.image_path && post.image_path !== path && post.image_path.startsWith(`${workspace.id}/`)) {
      await service.storage.from(BUCKET).remove([post.image_path]);
    }

    await logAuditEvent({
      workspaceId: workspace.id,
      actorType: "user",
      actorId: workspace.owner_user_id,
      action: "generate_post_image",
      resourceType: "content_post",
      resourceId: post.id,
      safeMetadata: { provider: "cloudflare_workers_ai", model: CLOUDFLARE_IMAGE_MODEL, style, format },
    });

    return NextResponse.json({
      data: {
        imagePath: updated.image_path,
        previewUrl,
        model: CLOUDFLARE_IMAGE_MODEL,
        status: updated.status,
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof VisualPlanningError) {
      console.error("[image-generation] All visual planning providers failed", error.providerFailures);
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof CloudflareImageError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return apiError(error);
  } finally {
    const service = quotaReservation?.service;
    if (uploadedPath && service) {
      try {
        const { error } = await service.storage.from(BUCKET).remove([uploadedPath]);
        if (error) console.error("[image-generation] Failed to clean up unattached image upload.");
      } catch (cleanupError) {
        console.error("[image-generation] Failed to clean up unattached image upload.", cleanupError);
      }
    }
    if (quotaReservation && !quotaCommitted) {
      try {
        const { error } = await quotaReservation.service.rpc("release_image_generation_reservation", {
          p_reservation_id: quotaReservation.reservationId,
        });
        if (error) console.error("[image-generation] Failed to release image quota reservation.");
      } catch (releaseError) {
        console.error("[image-generation] Failed to release image quota reservation.", releaseError);
      }
    }
  }
}
