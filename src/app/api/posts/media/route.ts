import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { apiError } from "@/lib/api/respond";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "nunuza-post-media";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGES = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Format = "text" | "image_carousel" | "document";
type ValidatedAsset = { bytes: Uint8Array; mime: string; ext: string; fileName: string };

function detectMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  return null;
}

function parseIds(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== "string" || !UUID_PATTERN.test(id))) {
      throw new Error("Invalid media selection.");
    }
    return [...new Set(parsed)];
  } catch {
    throw new Error("The selected slides could not be verified. Refresh and try again.");
  }
}

async function signedMedia(service: ReturnType<typeof createServiceClient>, media: Array<Record<string, unknown>>) {
  return Promise.all(media.map(async (asset) => {
    const { data, error } = await service.storage.from(BUCKET).createSignedUrl(String(asset.storage_path), 3600);
    if (error || !data?.signedUrl) throw new Error("A private slide preview could not be created.");
    return { ...asset, preview_url: data.signedUrl };
  }));
}

export async function GET(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const postId = new URL(request.url).searchParams.get("postId");
    if (!postId || !UUID_PATTERN.test(postId)) {
      return NextResponse.json({ error: "A valid postId is required." }, { status: 400 });
    }
    const service = createServiceClient();
    const { data: post, error: postError } = await service
      .from("content_posts")
      .select("id, workspace_id, text, internal_title, status, post_format, version")
      .eq("id", postId)
      .eq("workspace_id", workspace.id)
      .maybeSingle();
    if (postError || !post) return NextResponse.json({ error: "Post not found." }, { status: 404 });
    const { data: media, error: mediaError } = await service
      .from("content_post_media")
      .select("id, media_type, storage_path, mime_type, byte_size, sort_order, alt_text, created_at")
      .eq("workspace_id", workspace.id)
      .eq("post_id", postId)
      .order("sort_order", { ascending: true });
    if (mediaError) throw new Error("Post slides could not be loaded.");
    return NextResponse.json({ data: { post, media: await signedMedia(service, (media ?? []) as Array<Record<string, unknown>>) } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  const uploadedPaths: string[] = [];
  let createdPostId: string | null = null;
  let activePostId: string | null = null;
  let activeWorkspaceId: string | null = null;
  let service: ReturnType<typeof createServiceClient> | null = null;
  try {
    const workspace = await requireWorkspace();
    activeWorkspaceId = workspace.id;
    const form = await request.formData();
    const formatValue = form.get("format");
    if (formatValue !== "text" && formatValue !== "image_carousel" && formatValue !== "document") {
      return NextResponse.json({ error: "Choose a post format." }, { status: 400 });
    }
    const format: Format = formatValue;
    const title = String(form.get("title") ?? "").trim().slice(0, 160);
    const caption = String(form.get("caption") ?? "").trim();
    const postIdValue = String(form.get("postId") ?? "");
    const postId = postIdValue || null;
    if (postId && !UUID_PATTERN.test(postId)) return NextResponse.json({ error: "Invalid post." }, { status: 400 });
    if (caption.length > 3000) return NextResponse.json({ error: "Caption must be 3,000 characters or fewer." }, { status: 400 });

    service = createServiceClient();
    let existingPost: Record<string, unknown> | null = null;
    let oldMedia: Array<Record<string, unknown>> = [];
    if (postId) {
      const { data, error } = await service.from("content_posts").select("*")
        .eq("id", postId).eq("workspace_id", workspace.id).maybeSingle();
      if (error || !data) return NextResponse.json({ error: "Post not found." }, { status: 404 });
      if (data.status !== "draft") {
        return NextResponse.json({ error: "Only drafts can be edited. Return the post to draft before changing its slides." }, { status: 409 });
      }
      existingPost = data;
      activePostId = postId;
      const { data: currentMedia, error: mediaError } = await service.from("content_post_media").select("*")
        .eq("workspace_id", workspace.id).eq("post_id", postId).order("sort_order", { ascending: true });
      if (mediaError) throw new Error("Existing slides could not be loaded.");
      oldMedia = (currentMedia ?? []) as Array<Record<string, unknown>>;
    }

    const keepIds = postId ? parseIds(form.get("existingMediaIds")) : [];
    const keepSet = new Set(keepIds);
    if (keepIds.some((id) => !oldMedia.some((asset) => asset.id === id))) {
      return NextResponse.json({ error: "One or more selected slides do not belong to this post." }, { status: 403 });
    }
    const retained = oldMedia.filter((asset) => keepSet.has(String(asset.id)));

    const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    const source = String(form.get("source") ?? "upload");
    const assets: ValidatedAsset[] = [];

    const stagedPaths: string[] = [];
    if (source === "ai") {
      if (format !== "image_carousel" || files.length > 0) {
        return NextResponse.json({ error: "AI slide creation is available for image carousels." }, { status: 400 });
      }
      let stagedValue: unknown;
      try { stagedValue = JSON.parse(String(form.get("stagedMedia") ?? "[]")); } catch { stagedValue = null; }
      if (!Array.isArray(stagedValue) || stagedValue.length < 2 || stagedValue.length > 5 ||
          stagedValue.some((path) => typeof path !== "string" || !path.startsWith(`${workspace.id}/staged/`) || path.includes(".."))) {
        return NextResponse.json({ error: "Generate and review 2–5 AI slides before saving the post." }, { status: 422 });
      }
      for (let index = 0; index < stagedValue.length; index += 1) {
        const stagedPath = String(stagedValue[index]);
        if (stagedPaths.includes(stagedPath)) return NextResponse.json({ error: "Duplicate AI slide selected." }, { status: 422 });
        const { data: file, error } = await service.storage.from(BUCKET).download(stagedPath);
        if (error || !file) return NextResponse.json({ error: "An AI slide preview expired. Generate it again." }, { status: 404 });
        const bytes = new Uint8Array(await file.arrayBuffer());
        const mime = detectMime(bytes);
        if (mime !== "image/jpeg" || bytes.byteLength > 5 * 1024 * 1024) {
          return NextResponse.json({ error: "An AI slide is invalid. Generate it again." }, { status: 415 });
        }
        stagedPaths.push(stagedPath);
        assets.push({ bytes, mime, ext: "jpg", fileName: `AI slide ${index + 1}.jpg` });
      }
    } else {
      if (source !== "upload" && source !== "template") return NextResponse.json({ error: "Unsupported slide source." }, { status: 400 });
      if (files.length > MAX_IMAGES) return NextResponse.json({ error: "A post can contain at most 20 slides." }, { status: 422 });
      for (const file of files) {
        if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "Each file must be 20 MB or smaller." }, { status: 413 });
        const bytes = new Uint8Array(await file.arrayBuffer());
        const mime = detectMime(bytes);
        if (!mime || (format === "image_carousel" && !mime.startsWith("image/")) || (format === "document" && mime !== "application/pdf")) {
          return NextResponse.json({ error: "One of your files has an unsupported format. Use JPG, PNG, or PDF as appropriate." }, { status: 415 });
        }
        assets.push({ bytes, mime, ext: mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "pdf", fileName: file.name });
      }
    }

    const totalMedia = retained.length + assets.length;
    if (format === "text" && (caption.length === 0 || totalMedia !== 0)) {
      return NextResponse.json({ error: "Add post text. Text-only posts do not need media." }, { status: 422 });
    }
    if (format === "image_carousel" && (totalMedia < 2 || totalMedia > MAX_IMAGES || retained.some((asset) => asset.media_type !== "image"))) {
      return NextResponse.json({ error: "An image carousel requires 2–20 image slides." }, { status: 422 });
    }
    if (format === "document" && (totalMedia !== 1 || (retained.length && retained[0].media_type !== "document"))) {
      return NextResponse.json({ error: "A document post requires one PDF." }, { status: 422 });
    }

    let post: Record<string, unknown>;
    if (existingPost) {
      post = existingPost;
    } else {
      const { data, error } = await service.from("content_posts").insert({
        workspace_id: workspace.id,
        text: caption,
        internal_title: title || (format === "document" ? "PDF document" : format === "image_carousel" ? "Image carousel" : "Text post"),
        status: "draft",
        post_format: format,
        version: 1,
        created_by: workspace.owner_user_id,
      }).select("*").single();
      if (error || !data) throw new Error("The post could not be created.");
      post = data;
      createdPostId = String(data.id);
    }

    const newRows: Array<Record<string, unknown>> = [];
    for (let index = 0; index < assets.length; index += 1) {
      const asset = assets[index];
      const path = `${workspace.id}/${String(post.id)}/${crypto.randomUUID()}.${asset.ext}`;
      const { error: uploadError } = await service.storage.from(BUCKET).upload(path, asset.bytes, {
        contentType: asset.mime, cacheControl: "3600", upsert: false,
      });
      if (uploadError) throw new Error("Your media could not be saved. Please try again.");
      uploadedPaths.push(path);
      newRows.push({
        workspace_id: workspace.id, post_id: post.id,
        media_type: format === "document" ? "document" : "image",
        storage_path: path, mime_type: asset.mime, byte_size: asset.bytes.byteLength,
        sort_order: retained.length + index, alt_text: null,
      });
    }
    if (newRows.length) {
      const { error } = await service.from("content_post_media").insert(newRows);
      if (error) throw new Error("Your new slides could not be attached.");
    }

    for (let index = 0; index < retained.length; index += 1) {
      const { error } = await service.from("content_post_media").update({ sort_order: index })
        .eq("id", retained[index].id).eq("workspace_id", workspace.id).eq("post_id", post.id);
      if (error) throw new Error("Slide order could not be saved.");
    }

    const { data: updatedPost, error: updateError } = await service.from("content_posts").update({
      text: caption,
      internal_title: title || (format === "document" ? "PDF document" : format === "image_carousel" ? "Image carousel" : "Text post"),
      post_format: format,
      status: "draft",
      version: Number(post.version ?? 1) + (existingPost ? 1 : 0),
      updated_at: new Date().toISOString(),
    }).eq("id", post.id).eq("workspace_id", workspace.id)
      .select("id, workspace_id, text, internal_title, status, post_format, version, created_at, updated_at").single();
    if (updateError || !updatedPost) throw new Error("The post could not be updated.");

    const removed = oldMedia.filter((asset) => !keepSet.has(String(asset.id)));
    if (removed.length) {
      const { error } = await service.from("content_post_media").delete()
        .eq("workspace_id", workspace.id).eq("post_id", post.id)
        .in("id", removed.map((asset) => String(asset.id)));
      if (error) throw new Error("Removed slides could not be updated.");
      await service.storage.from(BUCKET).remove(removed.map((asset) => String(asset.storage_path)));
    }

    const { data: media, error: mediaError } = await service.from("content_post_media")
      .select("id, media_type, storage_path, mime_type, byte_size, sort_order, alt_text, created_at")
      .eq("workspace_id", workspace.id).eq("post_id", post.id).order("sort_order", { ascending: true });
    if (mediaError) throw new Error("The saved slides could not be loaded.");
    if (source === "ai" && stagedPaths.length) {
      await service.storage.from(BUCKET).remove(stagedPaths).catch(() => {});
    }
    return NextResponse.json({
      data: { post: { ...updatedPost, media: await signedMedia(service, (media ?? []) as Array<Record<string, unknown>>) } },
    }, { status: existingPost ? 200 : 201 });
  } catch (error) {
    if (service && uploadedPaths.length) {
      if (activePostId && activeWorkspaceId) await service.from("content_post_media").delete().eq("workspace_id", activeWorkspaceId).eq("post_id", activePostId).in("storage_path", uploadedPaths).catch(() => {});
      await service.storage.from(BUCKET).remove(uploadedPaths).catch(() => {});
    }
    if (service && createdPostId) await service.from("content_posts").delete().eq("id", createdPostId).catch(() => {});
    return apiError(error);
  }
}
