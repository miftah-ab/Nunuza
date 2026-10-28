"use client";

/**
 * Interactive Content Manager Component.
 *
 * Implements Phase 3 content review and editing UI:
 * - Filter by status (All, Draft, Needs Review, Approved, Scheduled, Published)
 * - Quick draft generation via AI or manual creation
 * - Inline post editing with live character count (max 3000)
 * - Status transitions (draft -> needs_review -> approved)
 * - Export single or all drafts (JSON, TXT, MD)
 * - Transparent scheduling gate explanation for preview draft_only users
 */

import React, { useState } from "react";
import type { ContentPost, PostStatus, Workspace } from "@/types/database";
import {
  Sparkles,
  Plus,
  Download,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  Trash2,
  Edit3,
  Calendar,
  Lock,
} from "lucide-react";

interface ContentManagerProps {
  initialPosts: ContentPost[];
  workspace: Workspace;
  usageCount: number;
  usageLimit: number;
}

export function ContentManager({
  initialPosts,
  workspace,
  usageCount,
  usageLimit,
}: ContentManagerProps) {
  const [posts, setPosts] = useState<ContentPost[]>(initialPosts);
  const [filter, setFilter] = useState<string>("all");
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<ContentPost | null>(null);

  // AI Generation Form State
  const [aiTopic, setAiTopic] = useState("");
  const [aiPillar, setAiPillar] = useState("");
  const [aiNotes, setAiNotes] = useState("");
  const [aiLength, setAiLength] = useState<"short" | "medium" | "long">("medium");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Manual Form State
  const [manualTitle, setManualTitle] = useState("");
  const [manualText, setManualText] = useState("");
  const [manualPillar, setManualPillar] = useState("");
  const [isSavingManual, setIsSavingManual] = useState(false);

  // Filter posts
  const filteredPosts = posts.filter((post) => {
    if (filter === "all") return true;
    return post.status === filter;
  });

  // Handle AI draft generation
  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiTopic.trim()) return;

    setIsGenerating(true);
    setGenerationError(null);

    try {
      const res = await fetch("/api/generate/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: aiTopic.trim(),
          pillar: aiPillar.trim() || undefined,
          notes: aiNotes.trim() || undefined,
          targetLength: aiLength,
        }),
      });

      const json = (await res.json()) as any;
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to generate draft.");
      }

      setPosts((prev) => [json.data.post, ...prev]);
      setIsAiModalOpen(false);
      setAiTopic("");
      setAiNotes("");
      setAiPillar("");
    } catch (err: unknown) {
      setGenerationError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Handle Manual draft creation
  const handleSaveManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualText.trim()) return;

    setIsSavingManual(true);
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: manualText.trim(),
          internal_title: manualTitle.trim() || undefined,
          pillar: manualPillar.trim() || undefined,
        }),
      });

      const json = (await res.json()) as any;
      if (!res.ok) throw new Error(json.error ?? "Failed to save post.");

      setPosts((prev) => [json.data.post, ...prev]);
      setIsManualModalOpen(false);
      setManualTitle("");
      setManualText("");
      setManualPillar("");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setIsSavingManual(false);
    }
  };

  // Handle Post Update
  const handleUpdatePost = async (updatedFields: Partial<ContentPost>) => {
    if (!editingPost) return;

    try {
      const res = await fetch(`/api/posts/${editingPost.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedFields),
      });

      const json = (await res.json()) as any;
      if (!res.ok) throw new Error(json.error ?? "Failed to update post.");

      setPosts((prev) =>
        prev.map((p) => (p.id === editingPost.id ? json.data.post : p))
      );
      setEditingPost(null);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Update failed.");
    }
  };

  // Handle Delete/Cancel
  const handleDeletePost = async (postId: string) => {
    if (!confirm("Are you sure you want to delete this post?")) return;

    try {
      const res = await fetch(`/api/posts/${postId}`, { method: "DELETE" });
      const json = (await res.json()) as any;
      if (!res.ok) throw new Error(json.error ?? "Failed to delete post.");

      setPosts((prev) => prev.filter((p) => p.id !== postId));
      if (editingPost?.id === postId) setEditingPost(null);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Delete failed.");
    }
  };

  // Export posts
  const handleExportAll = () => {
    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(posts, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute(
      "download",
      `nunuza-posts-${new Date().toISOString().split("T")[0]}.json`
    );
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const getStatusBadge = (status: PostStatus) => {
    switch (status) {
      case "draft":
        return <span className="badge badge-draft">Draft</span>;
      case "needs_review":
        return <span className="badge badge-review">Needs Review</span>;
      case "approved":
        return <span className="badge badge-beta">Approved</span>;
      case "scheduled":
        return <span className="badge badge-active flex items-center gap-1"><Clock size={12} /> Scheduled</span>;
      case "published":
        return <span className="badge badge-active flex items-center gap-1"><CheckCircle2 size={12} /> Published</span>;
      case "failed":
        return <span className="badge badge-inactive flex items-center gap-1"><AlertCircle size={12} /> Failed</span>;
      default:
        return <span className="badge badge-draft">{status}</span>;
    }
  };

  const isDraftOnly = workspace.entitlement_type === "draft_only";

  return (
    <div className="space-y-6">
      {/* Top action bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Content & Drafts</h1>
          <p className="text-sm text-ink-secondary">
            Manage your personal LinkedIn pipeline. Draft, review, and export from one place.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleExportAll}
            className="btn-ghost flex items-center gap-1.5 text-xs"
            title="Export all drafts as JSON (Available for all workspaces)"
          >
            <Download size={14} /> Export
          </button>
          <button
            onClick={() => setIsManualModalOpen(true)}
            className="btn-secondary flex items-center gap-1.5 text-xs"
          >
            <Plus size={14} /> New Draft
          </button>
          <button
            onClick={() => setIsAiModalOpen(true)}
            className="btn-primary flex items-center gap-1.5 text-xs"
          >
            <Sparkles size={14} /> Generate with AI
          </button>
        </div>
      </div>

      {/* Quota & preview notice */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-forest-light/60 border border-forest-muted rounded-lg text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-ink">Monthly Quota:</span>
          <span className="text-ink-secondary">
            {usageCount} of {usageLimit} workflow items used this month.
          </span>
        </div>
        {isDraftOnly && (
          <div className="flex items-center gap-1.5 text-ink-secondary">
            <Lock size={12} className="text-amber-600" />
            <span>Draft-only preview active. Scheduling & publishing require verified beta access.</span>
          </div>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border pb-2">
        {[
          { key: "all", label: "All Posts" },
          { key: "draft", label: "Drafts" },
          { key: "needs_review", label: "Needs Review" },
          { key: "approved", label: "Approved" },
          { key: "scheduled", label: "Scheduled" },
          { key: "published", label: "Published" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              filter === tab.key
                ? "bg-forest text-white"
                : "text-ink-secondary hover:text-ink hover:bg-forest-light/50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Posts List */}
      {filteredPosts.length === 0 ? (
        <div className="card p-12 text-center text-ink-secondary text-sm">
          <FileText size={32} className="mx-auto mb-3 text-border" />
          <p className="font-medium text-ink">No posts found in this status.</p>
          <p className="text-xs mt-1">Generate a draft with AI or create one manually.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredPosts.map((post) => (
            <div
              key={post.id}
              className="card p-5 hover:border-forest/40 transition-colors flex flex-col justify-between gap-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2.5 mb-1.5">
                    {getStatusBadge(post.status)}
                    {post.pillar && (
                      <span className="text-xs bg-forest-light px-2 py-0.5 rounded text-forest font-medium">
                        {post.pillar}
                      </span>
                    )}
                    <span className="text-xs text-ink-secondary">
                      v{post.version} • {new Date(post.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                  <h3 className="font-semibold text-ink text-sm">
                    {post.internal_title ?? "Untitled Post"}
                  </h3>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setEditingPost(post)}
                    className="p-1.5 text-ink-secondary hover:text-forest rounded hover:bg-forest-light"
                    title="Edit post"
                  >
                    <Edit3 size={15} />
                  </button>
                  <button
                    onClick={() => handleDeletePost(post.id)}
                    className="p-1.5 text-ink-secondary hover:text-danger rounded hover:bg-danger/10"
                    title="Delete post"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              {/* Text Snippet */}
              <p className="text-xs text-ink/90 whitespace-pre-line line-clamp-3 font-sans">
                {post.text}
              </p>

              {/* Card Footer: Quick Actions */}
              <div className="flex items-center justify-between pt-2 border-t border-border/60 text-xs">
                <span className="text-ink-secondary">
                  {post.text.length} / 3000 chars
                </span>

                <div className="flex items-center gap-2">
                  {post.status === "draft" && (
                    <button
                      onClick={() => {
                        setEditingPost(post);
                        handleUpdatePost({ status: "needs_review" });
                      }}
                      className="text-forest hover:underline font-medium text-xs"
                    >
                      Submit for Review
                    </button>
                  )}
                  {post.status === "needs_review" && (
                    <button
                      onClick={() => {
                        setEditingPost(post);
                        handleUpdatePost({ status: "approved" });
                      }}
                      className="text-forest hover:underline font-medium text-xs"
                    >
                      Approve
                    </button>
                  )}
                  {post.status === "approved" && isDraftOnly && (
                    <span
                      className="text-ink-secondary flex items-center gap-1 cursor-not-allowed"
                      title="Scheduling is disabled for draft_only preview"
                    >
                      <Lock size={11} /> Scheduling Gated
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* AI Generation Modal */}
      {isAiModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card max-w-lg w-full p-6 shadow-xl animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-ink flex items-center gap-2">
                <Sparkles size={18} className="text-forest" /> Generate LinkedIn Draft
              </h2>
              <button
                onClick={() => setIsAiModalOpen(false)}
                className="text-ink-secondary hover:text-ink text-sm"
              >
                ✕
              </button>
            </div>

            {generationError && (
              <div className="mb-4 p-3 rounded bg-danger/10 border border-danger/20 text-danger text-xs">
                {generationError}
              </div>
            )}

            <form onSubmit={handleGenerate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  Topic / Core Idea *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Why we pivoted our pricing from seat-based to usage"
                  value={aiTopic}
                  onChange={(e) => setAiTopic(e.target.value)}
                  className="input-field text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink mb-1">
                    Content Pillar (optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Founding journey"
                    value={aiPillar}
                    onChange={(e) => setAiPillar(e.target.value)}
                    className="input-field text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-ink mb-1">
                    Length Target
                  </label>
                  <select
                    value={aiLength}
                    onChange={(e) => setAiLength(e.target.value as any)}
                    className="input-field text-sm"
                  >
                    <option value="short">Short (~500 chars)</option>
                    <option value="medium">Medium (~1200 chars)</option>
                    <option value="long">Long (~2000 chars)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  Source Notes / Bullet Points (optional)
                </label>
                <textarea
                  rows={3}
                  placeholder="e.g. Talk about the customer interview that made it obvious; 2 main failure modes..."
                  value={aiNotes}
                  onChange={(e) => setAiNotes(e.target.value)}
                  className="input-field text-sm resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAiModalOpen(false)}
                  className="btn-ghost text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isGenerating || !aiTopic.trim()}
                  className="btn-primary text-xs flex items-center gap-1.5"
                >
                  {isGenerating ? (
                    <>
                      <Sparkles size={14} className="animate-spin" /> Drafting...
                    </>
                  ) : (
                    "Generate Draft"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual Draft Modal */}
      {isManualModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card max-w-lg w-full p-6 shadow-xl animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-ink">New Manual Draft</h2>
              <button
                onClick={() => setIsManualModalOpen(false)}
                className="text-ink-secondary hover:text-ink text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveManual} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  Internal Title (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. 3 lessons from launching our beta"
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  className="input-field text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  Content Pillar (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Operational Lessons"
                  value={manualPillar}
                  onChange={(e) => setManualPillar(e.target.value)}
                  className="input-field text-sm"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-ink">Post Text *</label>
                  <span className="text-xs text-ink-secondary">
                    {manualText.length} / 3000
                  </span>
                </div>
                <textarea
                  required
                  rows={8}
                  maxLength={3000}
                  placeholder="Write your LinkedIn post here..."
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  className="input-field text-sm resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsManualModalOpen(false)}
                  className="btn-ghost text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingManual || !manualText.trim()}
                  className="btn-primary text-xs"
                >
                  {isSavingManual ? "Saving..." : "Save Draft"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Post Modal */}
      {editingPost && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card max-w-xl w-full p-6 shadow-xl animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-ink">Edit Post</h2>
                <span className="text-xs text-ink-secondary">Version {editingPost.version}</span>
              </div>
              <button
                onClick={() => setEditingPost(null)}
                className="text-ink-secondary hover:text-ink text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  Internal Title
                </label>
                <input
                  type="text"
                  value={editingPost.internal_title ?? ""}
                  onChange={(e) =>
                    setEditingPost({ ...editingPost, internal_title: e.target.value })
                  }
                  className="input-field text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  Status
                </label>
                <select
                  value={editingPost.status}
                  onChange={(e) =>
                    setEditingPost({ ...editingPost, status: e.target.value as PostStatus })
                  }
                  className="input-field text-sm"
                >
                  <option value="draft">Draft</option>
                  <option value="needs_review">Needs Review</option>
                  <option value="approved">Approved</option>
                  {!isDraftOnly && <option value="scheduled">Scheduled</option>}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-ink">Post Text</label>
                  <span className="text-xs text-ink-secondary">
                    {editingPost.text.length} / 3000
                  </span>
                </div>
                <textarea
                  rows={9}
                  maxLength={3000}
                  value={editingPost.text}
                  onChange={(e) =>
                    setEditingPost({ ...editingPost, text: e.target.value })
                  }
                  className="input-field text-sm resize-none"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => handleDeletePost(editingPost.id)}
                  className="btn-danger text-xs flex items-center gap-1"
                >
                  <Trash2 size={13} /> Delete
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingPost(null)}
                    className="btn-ghost text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleUpdatePost({
                        text: editingPost.text,
                        internal_title: editingPost.internal_title,
                        status: editingPost.status,
                      })
                    }
                    className="btn-primary text-xs"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
