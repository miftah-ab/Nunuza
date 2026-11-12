"use client";

import { useMemo, useState } from "react";
import type { ContentPost } from "@/types/database";
import { FileImage, FileText, Plus, X, ChevronUp, ChevronDown, Loader2 } from "lucide-react";

type PostFormat = "text" | "image_carousel" | "document";

export function MediaPostComposer({ onCreated }: { onCreated: (post: ContentPost) => void }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<PostFormat>("text");
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);

  const close = () => {
    previews.forEach((url) => URL.revokeObjectURL(url));
    setOpen(false);
    setFiles([]);
    setTitle("");
    setCaption("");
    setError(null);
    setFormat("text");
  };

  const move = (index: number, direction: -1 | 1) => {
    const next = [...files];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setFiles(next);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("format", format);
      form.set("title", title);
      form.set("caption", caption);
      files.forEach((file) => form.append("files", file));
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

  const canSubmit = format === "text"
    ? caption.trim().length > 0
    : format === "image_carousel"
      ? files.length >= 2 && files.length <= 20
      : files.length === 1;

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-secondary flex items-center gap-1.5 text-xs">
        <Plus size={14} /> New Post
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="media-post-title">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-surface p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="media-post-title" className="text-lg font-bold text-ink">Create a post</h2>
                <p className="mt-1 text-xs text-ink-secondary">Choose a format. Media-only posts do not need a caption.</p>
              </div>
              <button onClick={close} className="rounded p-1 text-ink-secondary hover:bg-surface-muted" aria-label="Close"><X size={18} /></button>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <button type="button" onClick={() => { setFormat("text"); setFiles([]); }} className={format === "text" ? "rounded-lg border border-forest bg-forest-light p-3 text-left" : "rounded-lg border border-border p-3 text-left"}>
                <FileText size={18} className="mb-2" />
                <span className="block text-sm font-semibold">Text only</span>
                <span className="text-xs text-ink-secondary">No media</span>
              </button>
              <button type="button" onClick={() => { setFormat("image_carousel"); setFiles([]); }} className={format === "image_carousel" ? "rounded-lg border border-forest bg-forest-light p-3 text-left" : "rounded-lg border border-border p-3 text-left"}>
                <FileImage size={18} className="mb-2" />
                <span className="block text-sm font-semibold">Image carousel</span>
                <span className="text-xs text-ink-secondary">2–20 slides</span>
              </button>
              <button type="button" onClick={() => { setFormat("document"); setFiles([]); }} className={format === "document" ? "rounded-lg border border-forest bg-forest-light p-3 text-left" : "rounded-lg border border-border p-3 text-left"}>
                <FileText size={18} className="mb-2" />
                <span className="block text-sm font-semibold">PDF document</span>
                <span className="text-xs text-ink-secondary">One PDF</span>
              </button>
            </div>

            <label className="mt-4 block text-xs font-semibold text-ink">Internal title</label>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" placeholder="Give this post a name" />

            <label className="mt-4 block text-xs font-semibold text-ink">
              {format === "text" ? "Post text (required)" : "Caption (optional)"}
            </label>
            <textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={3000} rows={4} className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" placeholder={format === "text" ? "Write your LinkedIn post..." : "Add commentary, or leave empty for a media-only post."} />

            {format !== "text" && (
              <>
                <label className="mt-4 block text-xs font-semibold text-ink">{format === "image_carousel" ? "Slides" : "PDF file"}</label>
                <input
                  key={format}
                  type="file"
                  accept={format === "image_carousel" ? "image/jpeg,image/png" : "application/pdf,.pdf"}
                  multiple={format === "image_carousel"}
                  onChange={(event) => {
                    const selected = Array.from(event.target.files ?? []);
                    setFiles(format === "document" ? selected.slice(0, 1) : selected.slice(0, 20));
                  }}
                  className="mt-1 block w-full text-xs text-ink-secondary file:mr-3 file:rounded-md file:border-0 file:bg-forest-light file:px-3 file:py-2 file:text-xs file:font-semibold file:text-forest"
                />
              </>
            )}

            {format === "image_carousel" && files.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {files.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="overflow-hidden rounded-lg border border-border">
                    <img src={previews[index]} alt={file.name} className="aspect-square w-full object-cover" />
                    <div className="flex items-center justify-between p-1.5">
                      <span className="max-w-[70px] truncate text-[10px]">{index + 1}. {file.name}</span>
                      <div className="flex">
                        <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className="p-1 disabled:opacity-30" aria-label="Move slide up"><ChevronUp size={13} /></button>
                        <button type="button" onClick={() => move(index, 1)} disabled={index === files.length - 1} className="p-1 disabled:opacity-30" aria-label="Move slide down"><ChevronDown size={13} /></button>
                        <button type="button" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))} className="p-1 text-error" aria-label="Remove slide"><X size={13} /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {format === "document" && files[0] && <p className="mt-2 text-xs text-ink-secondary">{files[0].name} · {(files[0].size / 1024 / 1024).toFixed(1)} MB</p>}

            {error && <p role="alert" className="mt-3 rounded-lg bg-error/10 p-3 text-xs text-error">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={close} disabled={busy} className="btn-ghost text-xs">Cancel</button>
              <button onClick={submit} disabled={busy || !canSubmit} className="btn-primary flex items-center gap-2 text-xs disabled:opacity-50">
                {busy ? <><Loader2 size={13} className="animate-spin" /> Saving...</> : "Save as draft"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
