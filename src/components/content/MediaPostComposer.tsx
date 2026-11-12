"use client";

import { useEffect, useState } from "react";
import type { ContentPost, ContentPostMedia } from "@/types/database";
import { FileImage, FileText, Plus, X, ChevronUp, ChevronDown, Loader2, Sparkles, LayoutTemplate, Upload, WandSparkles } from "lucide-react";

type PostFormat = "text" | "image_carousel" | "document";
type ExistingMedia = ContentPostMedia & { preview_url: string };
type Source = "upload" | "template" | "ai";

const TEMPLATE_THEMES = [
  { id: "midnight", name: "Midnight", background: "#14263D", foreground: "#F5F1E8", accent: "#8CB7A3" },
  { id: "paper", name: "Editorial", background: "#F5F1E8", foreground: "#14263D", accent: "#547A68" },
  { id: "bold", name: "Bold", background: "#243F5C", foreground: "#FFFFFF", accent: "#E8B86D" },
] as const;

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

async function renderTemplateSlide(title: string, body: string, index: number, themeId: string) {
  const theme = TEMPLATE_THEMES.find((item) => item.id === themeId) ?? TEMPLATE_THEMES[0];
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser could not prepare the slide.");
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = theme.accent;
  ctx.fillRect(84, 100, 110, 12);
  ctx.fillStyle = theme.foreground;
  ctx.font = "600 30px Arial, sans-serif";
  ctx.fillText(`INSIGHT  /  0${index + 1}`, 84, 190);
  ctx.font = "bold 76px Arial, sans-serif";
  const titleLines = wrapCanvasText(ctx, title, 900);
  titleLines.slice(0, 4).forEach((line, lineIndex) => ctx.fillText(line, 84, 360 + lineIndex * 96));
  ctx.fillStyle = theme.accent;
  ctx.fillRect(84, 790, 160, 8);
  ctx.fillStyle = theme.foreground;
  ctx.font = "36px Arial, sans-serif";
  const bodyLines = wrapCanvasText(ctx, body, 880);
  bodyLines.slice(0, 7).forEach((line, lineIndex) => ctx.fillText(line, 84, 900 + lineIndex * 58));
  ctx.globalAlpha = 0.7;
  ctx.font = "24px Arial, sans-serif";
  ctx.fillText("Swipe to continue  →", 84, 1240);
  ctx.globalAlpha = 1;
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Slide export failed.")), "image/png"));
  return new File([blob], `nunuza-slide-${index + 1}.png`, { type: "image/png" });
}

export function MediaPostComposer({
  onCreated,
  editPost = null,
  onEditClose,
}: {
  onCreated: (post: ContentPost) => void;
  editPost?: ContentPost | null;
  onEditClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<PostFormat>("text");
  const [source, setSource] = useState<Source>("upload");
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [existing, setExisting] = useState<ExistingMedia[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<string[]>([
    "A clean editorial visual explaining the first key idea. Professional LinkedIn carousel slide background, strong focal point, generous negative space for text, no words or letters.",
    "A distinct visual metaphor for the second key idea. Professional LinkedIn carousel slide background, strong focal point, generous negative space for text, no words or letters.",
    "A memorable visual for the practical takeaway. Professional LinkedIn carousel slide background, strong focal point, generous negative space for text, no words or letters.",
  ]);
  const [templateTheme, setTemplateTheme] = useState("midnight");
  const [templateTitle, setTemplateTitle] = useState("The idea worth remembering");
  const [templateBodies, setTemplateBodies] = useState([
    "Start with the problem your audience recognizes.",
    "Explain the insight in one clear, useful point.",
    "Finish with one practical action they can take.",
  ]);

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  useEffect(() => {
    if (!editPost) return;
    let active = true;
    setOpen(true);
    setLoadingExisting(true);
    setError(null);
    fetch(`/api/posts/media?postId=${encodeURIComponent(editPost.id)}`)
      .then(async (response) => {
        const json = await response.json() as { error?: string; data?: { post: ContentPost; media: ExistingMedia[] } };
        if (!response.ok || !json.data) throw new Error(json.error ?? "Saved slides could not be loaded.");
        if (!active) return;
        setFormat((json.data.post.post_format ?? "text") as PostFormat);
        setTitle(json.data.post.internal_title ?? "");
        setCaption(json.data.post.text ?? "");
        setExisting(json.data.media ?? []);
        setFiles([]);
        setSource("upload");
      })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Saved slides could not be loaded."); })
      .finally(() => { if (active) setLoadingExisting(false); });
    return () => { active = false; };
  }, [editPost]);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setFiles([]);
    setExisting([]);
    setTitle("");
    setCaption("");
    setError(null);
    setFormat("text");
    setSource("upload");
    if (editPost) onEditClose?.();
  };

  const moveNew = (index: number, direction: -1 | 1) => {
    const next = [...files];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setFiles(next);
  };
  const moveExisting = (index: number, direction: -1 | 1) => {
    const next = [...existing];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setExisting(next);
  };

  const createTemplateSlides = async () => {
    setBusy(true);
    setError(null);
    try {
      const generated = await Promise.all(templateBodies.map((body, index) =>
        renderTemplateSlide(templateTitle.trim() || title.trim() || "A useful idea", body, index, templateTheme)
      ));
      setFiles(generated);
      setExisting([]);
      setSource("template");
      setFormat("image_carousel");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Template slides could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("format", format);
      form.set("title", title);
      form.set("caption", caption);
      form.set("source", source);
      if (editPost) form.set("postId", editPost.id);
      form.set("existingMediaIds", JSON.stringify(existing.map((item) => item.id)));
      files.forEach((file) => form.append("files", file));
      if (source === "ai") form.set("prompts", JSON.stringify(prompts));
      const response = await fetch("/api/posts/media", { method: "POST", body: form });
      const json = await response.json() as { error?: string; data?: { post: ContentPost } };
      if (!response.ok || !json.data?.post) throw new Error(json.error ?? "Your post could not be saved.");
      onCreated(json.data.post);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your post could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const pendingAiSlides = source === "ai" ? prompts.length : 0;
  const totalSlides = existing.length + files.length + pendingAiSlides;
  const canSubmit = format === "text"
    ? caption.trim().length > 0 && existing.length + files.length === 0
    : format === "image_carousel"
      ? totalSlides >= 2 && totalSlides <= 20 && (source !== "ai" || (prompts.length >= 2 && prompts.length <= 5 && prompts.every((item) => item.trim())))
      : existing.length + files.length === 1;

  return (
    <>
      {!editPost && (
        <button onClick={() => setOpen(true)} className="btn-secondary flex items-center gap-1.5 text-xs">
          <Plus size={14} /> New Post
        </button>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="media-post-title">
          <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-xl border border-border bg-surface p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="media-post-title" className="text-lg font-bold text-ink">{editPost ? "Edit media post" : "Create a post"}</h2>
                <p className="mt-1 text-xs text-ink-secondary">Text-only, media-only, or a caption with slides. Choose how to create your media.</p>
              </div>
              <button onClick={close} className="rounded p-1 text-ink-secondary hover:bg-surface-muted" aria-label="Close"><X size={18} /></button>
            </div>

            {loadingExisting ? (
              <div className="flex items-center gap-2 py-12 text-sm text-ink-secondary"><Loader2 size={16} className="animate-spin" /> Loading saved slides...</div>
            ) : (
              <>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  {([
                    ["text", "Text only", "No media"],
                    ["image_carousel", "Image carousel", "2–20 slides"],
                    ["document", "PDF document", "One PDF"],
                  ] as const).map(([value, label, description]) => (
                    <button key={value} type="button" onClick={() => { setFormat(value); setFiles([]); setExisting([]); setSource("upload"); }}
                      className={format === value ? "rounded-lg border border-forest bg-forest-light p-3 text-left" : "rounded-lg border border-border p-3 text-left"}>
                      {value === "image_carousel" ? <FileImage size={18} className="mb-2" /> : <FileText size={18} className="mb-2" />}
                      <span className="block text-sm font-semibold">{label}</span>
                      <span className="text-xs text-ink-secondary">{description}</span>
                    </button>
                  ))}
                </div>

                <label className="mt-4 block text-xs font-semibold text-ink">Internal title</label>
                <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" placeholder="Give this post a name" />
                <label className="mt-4 block text-xs font-semibold text-ink">{format === "text" ? "Post text (required)" : "Caption (optional)"}</label>
                <textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={3000} rows={4} className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" placeholder={format === "text" ? "Write your LinkedIn post..." : "Add commentary, or leave empty for a media-only post."} />

                {format === "image_carousel" && (
                  <>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <button type="button" onClick={() => setSource("upload")} className={source === "upload" ? "btn-primary text-xs" : "btn-secondary text-xs"}><Upload size={13} className="mr-1 inline" /> Upload images</button>
                      <button type="button" onClick={() => setSource("template")} className={source === "template" ? "btn-primary text-xs" : "btn-secondary text-xs"}><LayoutTemplate size={13} className="mr-1 inline" /> Templates</button>
                      <button type="button" onClick={() => { setSource("ai"); setFiles([]); }} className={source === "ai" ? "btn-primary text-xs" : "btn-secondary text-xs"}><Sparkles size={13} className="mr-1 inline" /> AI slide visuals</button>
                    </div>

                    {source === "upload" && (
                      <>
                        <label className="mt-4 block text-xs font-semibold text-ink">Add JPG or PNG slides</label>
                        <input type="file" accept="image/jpeg,image/png" multiple onChange={(event) => setFiles((current) => [...current, ...Array.from(event.target.files ?? [])].slice(0, 20 - existing.length))} className="mt-1 block w-full text-xs text-ink-secondary file:mr-3 file:rounded-md file:border-0 file:bg-forest-light file:px-3 file:py-2 file:text-xs file:font-semibold file:text-forest" />
                      </>
                    )}

                    {source === "template" && (
                      <div className="mt-4 rounded-lg border border-border p-3">
                        <label className="block text-xs font-semibold text-ink">Choose a template style</label>
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          {TEMPLATE_THEMES.map((theme) => (
                            <button key={theme.id} type="button" onClick={() => setTemplateTheme(theme.id)} className={templateTheme === theme.id ? "rounded-lg border-2 border-forest p-2 text-left" : "rounded-lg border border-border p-2 text-left"}>
                              <span className="mb-2 block h-10 rounded" style={{ background: theme.background, borderBottom: `5px solid ${theme.accent}` }} />
                              <span className="text-xs font-semibold">{theme.name}</span>
                            </button>
                          ))}
                        </div>
                        <label className="mt-3 block text-xs font-semibold text-ink">Slide heading</label>
                        <input value={templateTitle} onChange={(event) => setTemplateTitle(event.target.value)} maxLength={90} className="mt-1 w-full rounded border border-border bg-surface px-3 py-2 text-sm" />
                        {templateBodies.map((body, index) => (
                          <div key={index} className="mt-3">
                            <label className="block text-xs font-semibold text-ink">Slide {index + 1} text</label>
                            <textarea rows={2} maxLength={240} value={body} onChange={(event) => setTemplateBodies((current) => current.map((item, i) => i === index ? event.target.value : item))} className="mt-1 w-full rounded border border-border bg-surface px-3 py-2 text-sm" />
                          </div>
                        ))}
                        <button type="button" onClick={createTemplateSlides} disabled={busy || templateBodies.some((item) => !item.trim())} className="btn-secondary mt-3 text-xs disabled:opacity-50"><WandSparkles size={13} className="mr-1 inline" /> Create 3 template slides</button>
                      </div>
                    )}

                    {source === "ai" && (
                      <div className="mt-4 rounded-lg border border-border p-3">
                        <p className="text-xs text-ink-secondary">Describe the visual for each slide. Nunuza creates the images; you can review, remove, and reorder them before saving.</p>
                        {prompts.map((prompt, index) => (
                          <div key={index} className="mt-3">
                            <div className="mb-1 flex items-center justify-between">
                              <label className="text-xs font-semibold text-ink">Slide {index + 1} visual direction</label>
                              {prompts.length > 2 && <button type="button" onClick={() => setPrompts((current) => current.filter((_, i) => i !== index))} className="text-xs text-error">Remove</button>}
                            </div>
                            <textarea rows={2} maxLength={2048} value={prompt} onChange={(event) => setPrompts((current) => current.map((item, i) => i === index ? event.target.value : item))} className="w-full rounded border border-border bg-surface px-3 py-2 text-sm" />
                          </div>
                        ))}
                        {prompts.length < 5 && <button type="button" onClick={() => setPrompts((current) => [...current, "A distinct professional editorial visual for this slide, with negative space for text and no words or letters."])} className="btn-ghost mt-2 text-xs"><Plus size={13} className="mr-1 inline" /> Add slide</button>}
                        <p className="mt-2 text-xs text-ink-muted">AI generation uses your workspace image allowance (maximum 5 images per hour).</p>
                      </div>
                    )}
                  </>
                )}

                {format === "document" && (
                  <>
                    <label className="mt-4 block text-xs font-semibold text-ink">PDF file</label>
                    <input type="file" accept="application/pdf,.pdf" onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 1))} className="mt-1 block w-full text-xs text-ink-secondary file:mr-3 file:rounded-md file:border-0 file:bg-forest-light file:px-3 file:py-2 file:text-xs file:font-semibold file:text-forest" />
                  </>
                )}

                {(existing.length > 0 || files.length > 0) && format === "image_carousel" && (
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {existing.map((item, index) => (
                      <div key={item.id} className="overflow-hidden rounded-lg border border-border">
                        <img src={item.preview_url} alt={item.alt_text ?? `Saved slide ${index + 1}`} className="aspect-square w-full object-cover" />
                        <div className="flex items-center justify-between p-1.5">
                          <span className="text-[10px]">Saved {index + 1}</span>
                          <div className="flex">
                            <button type="button" onClick={() => moveExisting(index, -1)} disabled={index === 0} className="p-1 disabled:opacity-30" aria-label="Move saved slide up"><ChevronUp size={13} /></button>
                            <button type="button" onClick={() => moveExisting(index, 1)} disabled={index === existing.length - 1} className="p-1 disabled:opacity-30" aria-label="Move saved slide down"><ChevronDown size={13} /></button>
                            <button type="button" onClick={() => setExisting((current) => current.filter((_, i) => i !== index))} className="p-1 text-error" aria-label="Remove saved slide"><X size={13} /></button>
                          </div>
                        </div>
                      </div>
                    ))}
                    {files.map((file, index) => (
                      <div key={`${file.name}-${index}`} className="overflow-hidden rounded-lg border border-border">
                        <img src={previews[index]} alt={file.name} className="aspect-square w-full object-cover" />
                        <div className="flex items-center justify-between p-1.5">
                          <span className="max-w-[70px] truncate text-[10px]">{file.name}</span>
                          <button type="button" onClick={() => moveNew(index, -1)} disabled={index === 0} className="p-1 disabled:opacity-30" aria-label="Move new slide up"><ChevronUp size={13} /></button>
                          <button type="button" onClick={() => moveNew(index, 1)} disabled={index === files.length - 1} className="p-1 disabled:opacity-30" aria-label="Move new slide down"><ChevronDown size={13} /></button>
                          <button type="button" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))} className="p-1 text-error" aria-label="Remove new slide"><X size={13} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {format === "document" && existing.map((item) => (
                  <div key={item.id} className="mt-3 flex items-center justify-between rounded-lg border border-border p-3 text-xs">
                    <span className="truncate">Saved PDF · {(item.byte_size / 1024 / 1024).toFixed(1)} MB</span>
                    <button type="button" onClick={() => setExisting([])} className="ml-3 text-error">Remove</button>
                  </div>
                ))}
                {format === "document" && files[0] && <p className="mt-2 text-xs text-ink-secondary">{files[0].name} · {(files[0].size / 1024 / 1024).toFixed(1)} MB</p>}
              </>
            )}

            {error && <p role="alert" className="mt-3 rounded-lg bg-error/10 p-3 text-xs text-error">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={close} disabled={busy} className="btn-ghost text-xs">Cancel</button>
              <button onClick={submit} disabled={busy || loadingExisting || !canSubmit} className="btn-primary flex items-center gap-2 text-xs disabled:opacity-50">
                {busy ? <><Loader2 size={13} className="animate-spin" /> Saving...</> : editPost ? "Save changes" : "Save as draft"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
