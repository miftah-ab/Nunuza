import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { apiError } from "@/lib/api/respond";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const BUCKET = "nunuza-post-media";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGES = 20;

type Format = "image_carousel" | "document";

function detectMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  return null;
}

export async function POST(request: Request) {
  const uploadedPaths: string[] = [];
  let createdPostId: string | null = null;
  try {
    const workspace = await requireWorkspace();
    const form = await request.formData();
    const format = form.get("format");
    const title = String(form.get("title") ?? "").trim().slice(0, 160);
    const caption = String(form.get("caption") ?? "").trim();
    const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);

    if (format !== "image_carousel" && format !== "document") {
      return NextResponse.json({ error: "Choose an image carousel or PDF document." }, { status: 400 });
    }
    if (caption.length > 3000) return NextResponse.json({ error: "Caption must be 3,000 characters or fewer." }, { status: 400 });
    if (format === "image_carousel" && (files.length < 2 || files.length > MAX_IMAGES)) {
      return NextResponse.json({ error: "Add between 2 and 20 images." }, { status: 422 });
    }
    if (format === "document" && files.length !== 1) {
      return NextResponse.json({ error: "Upload one PDF document." }, { status: 422 });
    }

    const validated: Array<{ file: File; bytes: Uint8Array; mime: string; ext: string }> = [];
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: "Each file must be 20 MB or smaller." }, { status: 413 });
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = detectMime(bytes);
      if (!mime || (format === "image_carousel" && !mime.startsWith("image/")) || (format === "document" && mime !== "application/pdf")) {
        return NextResponse.json({ error: "One of your files has an unsupported format. Use JPG, PNG, WebP, or PDF as appropriate." }, { status: 415 });
      }
      validated.push({ file, bytes, mime, ext: mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "pdf" });
    }

    const service = createServiceClient();
    const postFormat: Format = format;
    const { data: post, error: postError } = await service
      .from("content_posts")
      .insert({
        workspace_id: workspace.id,
        text: caption || null,
        internal_title: title || (format === "document" ? "PDF document" : "Image carousel"),
        status: "draft",
        post_format: postFormat,
        version: 1,
        created_by: workspace.owner_user_id,
      })
      .select("id, workspace_id, text, internal_title, status, post_format, version, created_at, updated_at")
      .single();
    if (postError || !post) throw new Error("The post could not be created.");
    createdPostId = post.id;

    const rows = [];
    for (let index = 0; index < validated.length; index += 1) {
      const asset = validated[index];
      const path = `${workspace.id}/${post.id}/${crypto.randomUUID()}.${asset.ext}`;
      const { error: uploadError } = await service.storage.from(BUCKET).upload(path, asset.bytes, {
        contentType: asset.mime,
        cacheControl: "3600",
        upsert: false,
      });
      if (uploadError) throw new Error("Your media could not be saved. Please try again.");
      uploadedPaths.push(path);
      rows.push({
        workspace_id: workspace.id,
        post_id: post.id,
        media_type: format === "document" ? "document" : "image",
        storage_path: path,
        mime_type: asset.mime,
        byte_size: asset.bytes.byteLength,
        sort_order: index,
        alt_text: null,
      });
    }

    const { data: media, error: mediaError } = await service
      .from("content_post_media")
      .insert(rows)
      .select("id, media_type, mime_type, byte_size, sort_order, alt_text, created_at");
    if (mediaError || !media) throw new Error("Your media could not be attached to the post.");

    return NextResponse.json({
      data: {
        post: { ...post, media },
        message: "Your media post is saved as a draft. Submit it for review before publishing.",
      },
    }, { status: 201 });
  } catch (error) {
    const service = createServiceClient();
    if (uploadedPaths.length) await service.storage.from(BUCKET).remove(uploadedPaths).catch(() => {});
    if (createdPostId) await service.from("content_posts").delete().eq("id", createdPostId).catch(() => {});
    return apiError(error);
  }
}
