"use client";

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
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!imagePath) {
      setPreviewUrl(null);
      return;
    }

    setIsLoadingPreview(true);
    fetch(`/api/generate/image?postId=${encodeURIComponent(postId)}`)
      .then(async (response) => {
        const payload = (await response.json()) as ImageApiResponse;
        if (!response.ok) throw new Error(payload.error || "Could not load image preview.");
        if (active) setPreviewUrl(payload.data?.previewUrl ?? null);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load image preview.");
      })
      .finally(() => {
        if (active) setIsLoadingPreview(false);
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
      if (!response.ok) throw new Error(payload.error || "Image generation failed.");
      if (!payload.data?.previewUrl || !payload.data.imagePath || !payload.data.status) {
        throw new Error("Image generation returned an incomplete response.");
      }
      setPreviewUrl(payload.data.previewUrl);
      onImageUpdated(payload.data.imagePath, payload.data.status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Image generation failed.");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <section className="rounded-lg border border-border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">Post image</h3>
          <p className="text-xs text-ink-secondary">Generate an optional visual with Cloudflare AI.</p>
        </div>
        {imagePath && <span className="text-[11px] text-forest font-medium">Image attached</span>}
      </div>

      {previewUrl ? (
        <img
          src={previewUrl}
          alt="Generated LinkedIn post visual"
          className="w-full max-h-72 object-contain rounded-md bg-surface"
        />
      ) : isLoadingPreview ? (
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
        disabled={isGenerating || isLoadingPreview}
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
