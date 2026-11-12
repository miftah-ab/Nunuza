/**
 * POST /api/generate/image — generate and attach a private image to a draft.
 * GET /api/generate/image?postId=... — return a short-lived preview URL.
 *
 * Images are generated on demand, stored privately per workspace, and never
 * published automatically. The LinkedIn publish pipeline remains separate.
 */

import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { apiError, parseBody } from "@/lib/api/respond";
import { createServiceClient } from "@/lib/supabase/server";
import { getPost } from "@/lib/db/posts";
import { logAuditEvent } from "@/lib/db/workspace";
import {
  CloudflareImageError,
  CLOUDFLARE_IMAGE_MODEL,
  generateCloudflareImage,
} from "@/lib/ai/cloudflare-image";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "nunuza-generated-images";
const HOURLY_IMAGE_LIMIT = 5;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface GenerateImageBody {
  postId: string;
  prompt?: string;
}

function buildImagePrompt(post: { internal_title: string | null; text: string }, direction?: string) {
  // The post is source material, not a request to invent an unrelated stock-photo subject.
  const subject = (post.internal_title || post.text.slice(0, 180)).replace(/\s+/g, " ").trim();
  const context = post.text.replace(/\s+/g, " ").slice(0, 1_000).trim();
  const userDirection = direction?.trim();

  return [
    "TASK: Create a context-faithful editorial image that visually explains the LinkedIn post below.",
    "SUBJECT LOCK: The main subject MUST be the concrete topic, object, process, place, or idea discussed in the post. Do not substitute a generic attractive person, woman, man, model, influencer, or unrelated portrait.",
    "PEOPLE RULE: Do not include any person unless the post is specifically about a person, a human role, a personal experience, a human interaction, or the user explicitly requests people in the visual direction. Never add a woman or man merely to make the image attractive.",
    "SCENE: Depict a specific, plausible scene containing visual evidence of the post's actual topic. Choose relevant objects, environment, and action from the post. Avoid generic office stock photography and decorative filler.",
    "FAITHFULNESS: Do not introduce products, brands, people, events, statistics, logos, or claims that are not supported by the post. If the topic is abstract, use a clear metaphor directly tied to its central idea.",
    "COMPOSITION: One clear focal subject, deliberate visual hierarchy, clean professional editorial art direction, realistic materials and lighting, strong readable silhouette, uncluttered background.",
    "FORMAT: Landscape-friendly square composition suitable for a LinkedIn feed crop. No text, letters, numbers, charts with labels, logos, watermarks, signatures, borders, or fake UI.",
    "AVOID: Random human portraits, beauty photography, fashion photography, unrelated faces, generic handshake photos, generic laptop-on-desk photos, collage layouts, split panels, and meaningless abstract decoration.",
    `POST TITLE: ${subject}`,
    `POST CONTENT (use this to identify the actual visual subject): ${context}`,
    userDirection ? `USER VISUAL DIRECTION (follow unless it conflicts with post accuracy): ${userDirection}` : "VISUAL DIRECTION: Choose the most relevant concrete scene based on the post. Prefer objects, environments, products, systems, or meaningful conceptual imagery over people.",
  ].join("\n").slice(0, 2048);
}

async function createPreviewUrl(path: string) {
  const service = createServiceClient();
  const { data, error } = await service.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) {
    throw new Error("Could not create a private image preview.");
  }
  return data.signedUrl;
}

export async function GET(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const postId = new URL(request.url).searchParams.get("postId");
    if (!postId || !UUID_PATTERN.test(postId)) {
      return NextResponse.json({ error: "A valid postId is required." }, { status: 400 });
    }

    const post = await getPost(workspace.id, postId);
    if (!post) return NextResponse.json({ error: "Post not found." }, { status: 404 });
    if (!post.image_path) return NextResponse.json({ data: { imagePath: null, previewUrl: null } });
    if (!post.image_path.startsWith(`${workspace.id}/`)) {
      return NextResponse.json({ error: "Image path is outside this workspace." }, { status: 403 });
    }

    return NextResponse.json({
      data: { imagePath: post.image_path, previewUrl: await createPreviewUrl(post.image_path) },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const body = await parseBody<GenerateImageBody>(request);
    if (!body?.postId || !UUID_PATTERN.test(body.postId)) {
      return NextResponse.json({ error: "A valid postId is required." }, { status: 400 });
    }
    if (typeof body.prompt === "string" && body.prompt.length > 1200) {
      return NextResponse.json({ error: "Visual direction must be 1,200 characters or fewer." }, { status: 400 });
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
 

    // Reuse the existing atomic usage counter; no additional quota table or migration.
    const service = createServiceClient();
    const now = new Date();
    const periodStart = now.toISOString().slice(0, 10);
    const hourKey = now.toISOString().slice(0, 13).replace(/[-T:]/g, "");
    const { data: usageCount, error: usageError } = await service.rpc("increment_usage_counter", {
      p_workspace_id: workspace.id,
      p_metric: `image_generation:${hourKey}`,
      p_period_start: periodStart,
      p_period_end: periodStart,
    });
    if (usageError) throw new Error("Image generation usage could not be verified.");
    if (Number(usageCount) > HOURLY_IMAGE_LIMIT) {
      return NextResponse.json(
        { error: "Image generation limit reached. Try again next hour (maximum 5 images per hour)." },
        { status: 429 }
      );
    }

    const prompt = buildImagePrompt(post, body.prompt);
    const generated = await generateCloudflareImage(prompt);
    const path = `${workspace.id}/${post.id}/${crypto.randomUUID()}.jpg`;

    const { error: uploadError } = await service.storage.from(BUCKET).upload(path, generated.bytes, {
      contentType: generated.contentType,
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadError) throw new Error("Generated image could not be saved. Please retry.");

    const { data: updated, error: updateError } = await service
      .from("content_posts")
      .update({
        image_path: path,
        image_prompt: prompt,
        image_model: generated.model,
        image_generated_at: new Date().toISOString(),
        // Adding an image changes the reviewed artifact; require review again.
        ...(post.status !== "draft" ? { status: "draft" } : {}),
      })
      .eq("id", post.id)
      .eq("workspace_id", workspace.id)
      .in("status", ["draft", "needs_review", "approved"])
      .select("id, image_path, status")
      .single();

    if (updateError || !updated) {
      await service.storage.from(BUCKET).remove([path]);
      throw new Error("Generated image could not be attached to the draft.");
    }

    // Remove the previous private image only after the new image is safely attached.
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
      safeMetadata: { provider: "cloudflare_workers_ai", model: CLOUDFLARE_IMAGE_MODEL },
    });

    return NextResponse.json({
      data: {
        imagePath: updated.image_path,
        previewUrl: await createPreviewUrl(updated.image_path),
        model: CLOUDFLARE_IMAGE_MODEL,
        status: updated.status,
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof CloudflareImageError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return apiError(error);
  }
}
