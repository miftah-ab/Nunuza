import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { apiError, parseBody } from "@/lib/api/respond";
import { createServiceClient } from "@/lib/supabase/server";
import { generateCloudflareImage } from "@/lib/ai/cloudflare-image";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "nunuza-post-media";
const HOURLY_IMAGE_LIMIT = 5;

interface GenerateSlidesBody {
  prompts: string[];
}

function isValidPromptList(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.length >= 2 &&
    value.length <= 5 &&
    value.every((prompt) => typeof prompt === "string" && prompt.trim().length > 0 && prompt.length <= 2048);
}

export async function POST(request: Request) {
  const stagedPaths: string[] = [];
  try {
    const workspace = await requireWorkspace();
    const body = await parseBody<GenerateSlidesBody>(request);
    if (!body || !isValidPromptList(body.prompts)) {
      return NextResponse.json({ error: "Provide 2–5 clear slide descriptions, each under 2,048 characters." }, { status: 422 });
    }
    if (!process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || !process.env.CLOUDFLARE_API_TOKEN?.trim()) {
      return NextResponse.json({ error: "AI slide creation is temporarily unavailable." }, { status: 503 });
    }

    const service = createServiceClient();
    const now = new Date();
    const periodStart = now.toISOString().slice(0, 10);
    const hourKey = now.toISOString().slice(0, 13).replace(/[-T:]/g, "");
    const metric = `image_generation:${hourKey}`;
    const { data: currentUsage, error: usageReadError } = await service.from("usage_counters")
      .select("count")
      .eq("workspace_id", workspace.id)
      .eq("metric", metric)
      .eq("period_start", periodStart)
      .maybeSingle();
    if (usageReadError) throw new Error("AI slide availability could not be verified.");
    if (Number(currentUsage?.count ?? 0) + body.prompts.length > HOURLY_IMAGE_LIMIT) {
      return NextResponse.json({
        error: "Nunuza image generation limit reached. You've used all 5 image generations available to your workspace this hour. Your limit will reset at the start of the next hour.",
      }, { status: 429 });
    }

    // Reserve every requested generation before spending provider credits.
    for (let index = 0; index < body.prompts.length; index += 1) {
      const { data: count, error } = await service.rpc("increment_usage_counter", {
        p_workspace_id: workspace.id,
        p_metric: metric,
        p_period_start: periodStart,
        p_period_end: periodStart,
      });
      if (error) throw new Error("AI slide availability could not be verified.");
      if (Number(count) > HOURLY_IMAGE_LIMIT) {
        return NextResponse.json({
          error: "Nunuza image generation limit reached. You've used all 5 image generations available to your workspace this hour. Your limit will reset at the start of the next hour.",
        }, { status: 429 });
      }
    }

    const generated = await Promise.all(body.prompts.map((prompt) => generateCloudflareImage(prompt)));
    const slides = [];
    for (let index = 0; index < generated.length; index += 1) {
      const image = generated[index];
      const path = `${workspace.id}/staged/${crypto.randomUUID()}.jpg`;
      const { error } = await service.storage.from(BUCKET).upload(path, image.bytes, {
        contentType: image.contentType,
        cacheControl: "3600",
        upsert: false,
      });
      if (error) throw new Error("A generated slide could not be saved for preview.");
      stagedPaths.push(path);
      const { data: signed, error: signedError } = await service.storage.from(BUCKET).createSignedUrl(path, 3600);
      if (signedError || !signed?.signedUrl) throw new Error("A generated slide preview could not be created.");
      slides.push({ path, preview_url: signed.signedUrl });
    }
    return NextResponse.json({ data: { slides } }, { status: 201 });
  } catch (error) {
    if (stagedPaths.length) {
      const service = createServiceClient();
      await service.storage.from(BUCKET).remove(stagedPaths).catch(() => {});
    }
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const body = await parseBody<{ paths?: string[] }>(request);
    if (!Array.isArray(body?.paths) || body.paths.length > 5 ||
        body.paths.some((path) => typeof path !== "string" || !path.startsWith(`${workspace.id}/staged/`) || path.includes(".."))) {
      return NextResponse.json({ error: "Invalid staged slide selection." }, { status: 400 });
    }
    if (body.paths.length) {
      const { error } = await createServiceClient().storage.from(BUCKET).remove(body.paths);
      if (error) throw new Error("Staged slides could not be removed.");
    }
    return NextResponse.json({ data: { removed: body.paths.length } });
  } catch (error) {
    return apiError(error);
  }
}
