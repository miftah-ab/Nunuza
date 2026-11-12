"use client";
import { userFacingError } from "@/lib/ui/error-message";

import Image from "next/image";
import { useEffect, useState } from "react";
import { ImagePlus, Loader2, RefreshCw } from "lucide-react";

interface ImageApiResponse {
  error?: string;
  data?: {
    previewUrl?: string | null;
    imagePath?: string | null;
    status?: string;
  };
}

interface PostImageGeneratorProps {
  postId: string;
  imagePath: string | null;
  onImageUpdated: (imagePath: string, status: string) => void;
}

export function PostImageGenerator({
  postId,
  imagePath,
  onImageUpdated,
}: PostImageGeneratorProps) {
  const [prompt, setPrompt] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!imagePath) return;

    fetch(`/api/generate/image?postId=${encodeURIComponent(postId)}`)
      .then(async (response) => {
        const payload = (await response.json()) as ImageApiResponse;
        if (!response.ok) throw new Error(payload.error || "We couldn’t load your image preview. Please try again.");
        if (active) setPreviewUrl(payload.data?.previewUrl ?? null);
      })
      .catch((cause: unknown) => {
        if (active) setError(userFacingError(cause, "We couldn’t load your image preview. Please try again."));
      });

    return () => { active = false; };
  }, [postId, imagePath]);

  async function generate() {
    setIsGenerating(true);
    setError(null);
    try {
      const response = await fetch("/api/generate/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, prompt: prompt.trim() || undefined }),
      });
      const payload = (await response.json()) as ImageApiResponse;
      if (!response.ok) throw new Error(payload.error || "We couldn’t create your image. Please try again.");
      if (!payload.data?.previewUrl || !payload.data.imagePath || !payload.data.status) {
        throw new Error("Your image wasn’t ready to use. Please try again.");
      }
      setPreviewUrl(payload.data.previewUrl);
      onImageUpdated(payload.data.imagePath, payload.data.status);
    } catch (cause) {
      setError(userFacingError(cause, "We couldn’t create your image. Please try again."));
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <section className="rounded-lg border border-border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">Post image</h3>
          <p className="text-xs text-ink-secondary">Create an optional image for your post.</p>
        </div>
        {imagePath && <span className="text-[11px] text-forest font-medium">Image attached</span>}
      </div>

      {imagePath && previewUrl ? (
        <Image
          src={previewUrl}
          alt="Generated LinkedIn post visual"
          width={1024}
          height={1024}
          unoptimized
          className="w-full max-h-72 object-contain rounded-md bg-surface"
        />
      ) : imagePath ? (
        <div className="h-24 flex items-center justify-center text-ink-secondary text-xs">
          <Loader2 size={14} className="animate-spin mr-2" /> Loading image...
        </div>
      ) : (
        <div className="h-20 rounded-md bg-surface flex items-center justify-center text-xs text-ink-secondary">
          No image attached
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-ink mb-1">Optional visual direction</label>
        <textarea
          rows={2}
          maxLength={1200}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="e.g. Minimal editorial illustration, warm natural lighting, founder working at a desk..."
          className="input-field text-xs resize-none"
        />
      </div>

      {error && <p role="alert" className="text-xs text-error">{error}</p>}

      <button
        type="button"
        onClick={generate}
        disabled={isGenerating}
        className="btn-secondary text-xs flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {isGenerating ? (
          <><Loader2 size={13} className="animate-spin" /> Generating image...</>
        ) : imagePath ? (
          <><RefreshCw size={13} /> Regenerate image</>
        ) : (
          <><ImagePlus size={13} /> Generate image</>
        )}
      </button>
      <p className="text-[11px] text-ink-muted">
        Images stay private in your workspace. Generating or regenerating an image never publishes the post.
      </p>
    </section>
  );
}
