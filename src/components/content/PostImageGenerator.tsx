"use client";

import { userFacingError } from "@/lib/ui/error-message";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { ImagePlus, Loader2, RefreshCw, Sparkles } from "lucide-react";

type ImageStyle = "editorial" | "cinematic" | "illustration" | "3d" | "minimalist";
type ImageFormat = "portrait" | "landscape" | "square";

interface VisualBrief {
  concept: string;
  subject: string;
  metaphor: string;
  composition: string;
  palette: string;
  mood: string;
  avoid: string[];
}

interface ImageApiResponse {
  error?: string;
  data?: {
    previewUrl?: string | null;
    imagePath?: string | null;
    status?: string;
    visualBrief?: VisualBrief;
  };
}

interface PostImageGeneratorProps {
  postId: string;
  imagePath: string | null;
  onImageUpdated: (imagePath: string, status: string) => void;
}

const styles: { value: ImageStyle; label: string; description: string }[] = [
  { value: "editorial", label: "Editorial photo", description: "Premium business-publication photography" },
  { value: "cinematic", label: "Cinematic", description: "Atmospheric, dramatic documentary look" },
  { value: "illustration", label: "Editorial illustration", description: "Distinctive conceptual artwork" },
  { value: "3d", label: "3D render", description: "Polished product-style visualization" },
  { value: "minimalist", label: "Minimalist", description: "Clean composition with negative space" },
];

const formats: { value: ImageFormat; label: string; dimensions: string }[] = [
  { value: "portrait", label: "Portrait", dimensions: "4:5" },
  { value: "landscape", label: "Landscape", dimensions: "16:9" },
  { value: "square", label: "Square", dimensions: "1:1" },
];

export function PostImageGenerator({ postId, imagePath, onImageUpdated }: PostImageGeneratorProps) {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<ImageStyle>("editorial");
  const [format, setFormat] = useState<ImageFormat>("portrait");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [visualBrief, setVisualBrief] = useState<VisualBrief | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyzePost = useCallback(async () => {
    setIsAnalyzing(true);
    setError(null);
    try {
      const response = await fetch("/api/generate/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "analyze", postId }),
      });
      const payload = (await response.json()) as ImageApiResponse;
      if (!response.ok) throw new Error(payload.error || "Nunuza couldn’t analyze this post. Please try again.");
      if (!payload.data?.visualBrief?.concept || !payload.data.visualBrief.subject) {
        throw new Error("Nunuza couldn’t create a clear visual direction. Please try again.");
      }
      setVisualBrief(payload.data.visualBrief);
    } catch (cause) {
      setVisualBrief(null);
      setError(userFacingError(cause, "Nunuza couldn’t analyze this post. Please try again."));
    } finally {
      setIsAnalyzing(false);
    }
  }, [postId]);

  useEffect(() => {
    void analyzePost();
  }, [analyzePost]);

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
    if (!visualBrief) {
      setError("Analyze the post before generating its image.");
      return;
    }
    setIsGenerating(true);
    setError(null);
    try {
      const response = await fetch("/api/generate/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, visualBrief, prompt: prompt.trim() || undefined, style, format }),
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

  const selectedStyle = styles.find((item) => item.value === style);

  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Create a post visual</h3>
          <p className="mt-1 text-xs text-ink-secondary">A custom visual designed around this post.</p>
        </div>
        {imagePath && <span className="shrink-0 rounded-full bg-forest/10 px-2.5 py-1 text-[11px] font-medium text-forest">Image attached</span>}
      </div>

      {imagePath && previewUrl ? (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <Image
            src={previewUrl}
            alt="Generated LinkedIn post visual"
            width={1280}
            height={1280}
            unoptimized
            className="mx-auto max-h-[420px] w-full object-contain"
          />
        </div>
      ) : imagePath ? (
        <div className="flex h-36 items-center justify-center rounded-lg bg-surface text-xs text-ink-secondary">
          <Loader2 size={14} className="mr-2 animate-spin" /> Loading your image...
        </div>
      ) : (
        <div className="flex h-28 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface text-xs text-ink-secondary">
          <ImagePlus size={20} />
          Your generated visual will appear here
        </div>
      )}

      <div className="rounded-lg border border-border bg-canvas/60 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-ink">
            <Sparkles size={14} className="text-forest" />
            Nunuza’s visual direction
          </div>
          <button
            type="button"
            onClick={() => void analyzePost()}
            disabled={isAnalyzing || isGenerating}
            className="text-xs font-medium text-forest hover:underline disabled:opacity-50"
          >
            {isAnalyzing ? "Analyzing post..." : "Re-analyze"}
          </button>
        </div>
        {isAnalyzing ? (
          <p className="flex items-center gap-2 text-xs text-ink-secondary"><Loader2 size={13} className="animate-spin" /> Finding the strongest visual idea in your post...</p>
        ) : visualBrief ? (
          <div className="space-y-2">
            <p className="text-sm font-medium leading-relaxed text-ink">{visualBrief.concept}</p>
            <p className="text-xs leading-relaxed text-ink-secondary"><span className="font-semibold text-ink">Main subject:</span> {visualBrief.subject}</p>
            <p className="text-xs leading-relaxed text-ink-secondary"><span className="font-semibold text-ink">Composition:</span> {visualBrief.composition}</p>
          </div>
        ) : (
          <p className="text-xs text-ink-secondary">Nunuza needs to analyze the post before it can create a relevant image.</p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="image-style" className="mb-1.5 block text-xs font-medium text-ink">Visual style</label>
          <select id="image-style" value={style} onChange={(event) => setStyle(event.target.value as ImageStyle)} className="input-field w-full text-sm">
            {styles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-ink-muted">{selectedStyle?.description}</p>
        </div>
        <div>
          <label htmlFor="image-format" className="mb-1.5 block text-xs font-medium text-ink">Image format</label>
          <select id="image-format" value={format} onChange={(event) => setFormat(event.target.value as ImageFormat)} className="input-field w-full text-sm">
            {formats.map((item) => <option key={item.value} value={item.value}>{item.label} ({item.dimensions})</option>)}
          </select>
          <p className="mt-1 text-[11px] text-ink-muted">Portrait is the recommended LinkedIn feed format.</p>
        </div>
      </div>

      <div>
        <label htmlFor="image-direction" className="mb-1.5 block text-xs font-medium text-ink">Adjust the creative direction <span className="font-normal text-ink-muted">(optional)</span></label>
        <textarea
          id="image-direction"
          rows={3}
          maxLength={1200}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Optional: emphasize a specific object, scene, or visual detail..."
          className="input-field w-full resize-y text-sm"
        />
        <p className="mt-1 text-[11px] text-ink-muted">Nunuza has already chosen a concept from your post. Add a detail or preference only if you want to change its art direction.</p>
      </div>

      {error && <p role="alert" className="rounded-md bg-error/10 p-2.5 text-xs text-error">{error}</p>}

      <button
        type="button"
        onClick={generate}
        disabled={isGenerating || isAnalyzing || !visualBrief}
        className="btn-secondary flex w-full items-center justify-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isGenerating ? (
          <><Loader2 size={14} className="animate-spin" /> Creating your visual...</>
        ) : imagePath ? (
          <><RefreshCw size={14} /> Regenerate visual</>
        ) : (
          <><ImagePlus size={14} /> Generate visual</>
        )}
      </button>
      <p className="text-[11px] leading-relaxed text-ink-muted">
        Images are private to your workspace. Regenerating replaces the attached image only after the new one is saved. It never publishes your post.
      </p>
    </section>
  );
}
