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
import { PostImageGenerator } from "@/components/content/PostImageGenerator";
import { MediaPostComposer } from "@/components/content/MediaPostComposer";
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
  X,
  Send,
  Loader2,
} from "lucide-react";

interface ContentManagerProps {
  initialPosts: ContentPost[];
  workspace: Workspace;
  usageCount: number;
  usageLimit: number;
  /** Read-only rendering for the public product preview. */
  preview?: boolean;
}

export function ContentManager({
  initialPosts,
  workspace,
  usageCount,
  usageLimit,
  preview = false,
}: ContentManagerProps) {
  const [posts, setPosts] = useState<ContentPost[]>(() => initialPosts.filter((post) => post.status !== "canceled"));
  const [confirmation, setConfirmation] = useState<{ type: "delete" | "cancel-schedule"; postId: string } | null>(null);
  const [isConfirmingAction, setIsConfirmingAction] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<ContentPost | null>(null);
  const [editingMediaPost, setEditingMediaPost] = useState<ContentPost | null>(null);

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

  // Schedule Modal State
  const [schedulingPost, setSchedulingPost] = useState<ContentPost | null>(null);
  const [scheduledDateTime, setScheduledDateTime] = useState("");
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // Publish Now State
  const [publishingPostId, setPublishingPostId] = useState<string | null>(null);
  const [publishFeedback, setPublishFeedback] = useState<{
    type: "success" | "error";
    postId?: string;
    message: string;
  } | null>(null);

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

      setPosts((prev) => [json.data, ...prev]);
      setIsManualModalOpen(false);
      setManualTitle("");
      setManualText("");
      setManualPillar("");
    } catch (err: unknown) {
      setPublishFeedback({ type: "error", message: err instanceof Error ? err.message : "Save failed." });
    } finally {
      setIsSavingManual(false);
    }
  };

  // Handle Post Update
  const handleUpdatePost = async (updatedFields: Partial<ContentPost>, targetPost?: ContentPost) => {
    const postToUpdate = targetPost || editingPost;
    if (!postToUpdate) return;

    try {
      const res = await fetch(`/api/posts/${postToUpdate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedFields),
      });

      const json = (await res.json()) as any;
      if (!res.ok) throw new Error(json.error ?? "Failed to update post.");

      setPosts((prev) =>
        prev.map((p) => (p.id === postToUpdate.id ? json.data : p))
      );
      if (editingPost?.id === postToUpdate.id) {
        setEditingPost(null);
      }
    } catch (err: unknown) {
      setPublishFeedback({ type: "error", message: err instanceof Error ? err.message : "Update failed." });
    }
  };

  // Destructive actions use the app confirmation dialog, never browser-native popups.
  const handleDeletePost = (postId: string) => {
    setConfirmation({ type: "delete", postId });
  };

  const handleConfirmAction = async () => {
    if (!confirmation || isConfirmingAction) return;
    setIsConfirmingAction(true);
    setPublishFeedback(null);
    try {
      const deleting = confirmation.type === "delete";
      const endpoint = deleting ? "/api/posts/" + confirmation.postId : "/api/posts/" + confirmation.postId + "/cancel-schedule";
      const res = await fetch(endpoint, { method: deleting ? "DELETE" : "POST" });
      const json = (await res.json()) as {
        error?: string;
        data?: { post?: ContentPost };
      };
      if (!res.ok) throw new Error(json.error || (deleting ? "Failed to delete post." : "Failed to cancel schedule."));
      const updatedPost = json.data?.post;
      if (deleting) {
        setPosts((prev) => prev.filter((post) => post.id !== confirmation.postId));
        if (editingPost && editingPost.id === confirmation.postId) setEditingPost(null);
        setPublishFeedback({ type: "success", message: "Post removed from active content. Its record is retained for audit history." });
      } else {
        if (!updatedPost) {
          throw new Error("The server did not return the updated post.");
        }
        setPosts((prev) => prev.map((post) => post.id === confirmation.postId ? updatedPost : post));
        setPublishFeedback({ type: "success", message: "Scheduled publication canceled." });
      }
      setConfirmation(null);
    } catch (err) {
      setPublishFeedback({ type: "error", message: err instanceof Error ? err.message : "The action could not be completed." });
    } finally {
      setIsConfirmingAction(false);
    }
  };

  // Handle Opening Schedule Modal
  const handleOpenSchedule = (post: ContentPost) => {
    setSchedulingPost(post);
    setScheduleError(null);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    const localIso = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T${pad(tomorrow.getHours())}:${pad(tomorrow.getMinutes())}`;
    setScheduledDateTime(localIso);
  };

  // Handle Schedule Submit
  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schedulingPost || !scheduledDateTime) return;

    setIsScheduling(true);
    setScheduleError(null);

    try {
      const scheduledIso = new Date(scheduledDateTime).toISOString();
      const res = await fetch(`/api/posts/${schedulingPost.id}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledFor: scheduledIso }),
      });

      const json = (await res.json()) as any;
      if (!res.ok) throw new Error(json.error ?? "Failed to schedule post.");

      setPosts((prev) =>
        prev.map((p) => (p.id === schedulingPost.id ? json.data.post : p))
      );
      setSchedulingPost(null);
    } catch (err: unknown) {
      setScheduleError(err instanceof Error ? err.message : "Scheduling failed.");
    } finally {
      setIsScheduling(false);
    }
  };

  // Reconcile: LinkedIn did not confirm a publication. The customer checks their
  // LinkedIn profile and tells us the outcome; Nunuza never guesses.
  const [reconcilingPostId, setReconcilingPostId] = useState<string | null>(null);

  const handleReconcile = async (
    post: ContentPost,
    outcome: "published" | "not_published"
  ) => {
    if (reconcilingPostId) return;
    setReconcilingPostId(post.id);
    setPublishFeedback(null);

    try {
      const res = await fetch(`/api/posts/${post.id}/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      });
      const json = (await res.json()) as any;
      if (!res.ok) throw new Error(json.error ?? "Could not record your answer.");

      const updatedPost = json.data as Partial<ContentPost>;
      if (!updatedPost.id || !updatedPost.status) {
        throw new Error("The server did not return the saved reconciliation state.");
      }
      setPosts((prev) =>
        prev.map((p) => p.id === post.id ? { ...p, ...updatedPost } : p)
      );
      setPublishFeedback({
        type: "success",
        postId: post.id,
        message:
          outcome === "published"
            ? "Recorded as published."
            : "Recorded as not published. You can publish or schedule it again.",
      });
    } catch (err: unknown) {
      setPublishFeedback({
        type: "error",
        postId: post.id,
        message: err instanceof Error ? err.message : "Could not record your answer.",
      });
    } finally {
      setReconcilingPostId(null);
    }
  };

  // Handle Cancel Schedule
  const handleCancelSchedule = (postId: string) => {
    setConfirmation({ type: "cancel-schedule", postId });
  };

  // Handle Publish Now (immediate processing through agent_jobs pipeline)
  const handlePublishNow = async (post: ContentPost) => {
    if (publishingPostId) return;

    setPublishingPostId(post.id);
    setPublishFeedback(null);

    try {
      const res = await fetch(`/api/posts/${post.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const json = (await res.json()) as any;
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to publish post.");
      }

      const publishedPost = json.data?.post as ContentPost | undefined;
      if (!publishedPost || publishedPost.status !== "published" || !publishedPost.published_at) {
        throw new Error("The publishing request returned without a confirmed saved publication. Refresh the post before trying again.");
      }
      setPosts((prev) =>
        prev.map((p) => p.id === post.id ? publishedPost : p)
      );
      setPublishFeedback({
        type: "success",
        postId: post.id,
        message: "Published successfully to LinkedIn.",
      });
    } catch (err: unknown) {
      setPublishFeedback({
        type: "error",
        postId: post.id,
        message: err instanceof Error ? err.message : "Publishing failed.",
      });
    } finally {
      setPublishingPostId(null);
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
        return <span className="badge-draft-only">Draft</span>;
      case "needs_review":
        return <span className="badge-beta">Needs Review</span>;
      case "approved":
        return <span className="badge-active">Approved</span>;
      case "scheduled":
        return <span className="badge-active flex items-center gap-1"><Clock size={12} /> Scheduled</span>;
      case "published":
        return <span className="badge-active flex items-center gap-1"><CheckCircle2 size={12} /> Published</span>;
      case "failed":
        return <span className="badge-error flex items-center gap-1"><AlertCircle size={12} /> Failed</span>;
      case "needs_reconciliation":
        return <span className="badge-error flex items-center gap-1"><AlertCircle size={12} /> Check LinkedIn</span>;
      default:
        return <span className="badge-draft-only">{status}</span>;
    }
  };

  const isPrivateBeta = workspace.entitlement_type === "internal_beta";

  const canPublishPosts =
    isPrivateBeta ||
    workspace.entitlement_type === "paid_trial" ||
    workspace.entitlement_type === "paid_active";

  // The marketing page uses the same content manager UI with illustrative,
  // read-only sample records. No API actions are exposed in preview mode.
  if (preview) {
    return (
      <section aria-label="Content manager preview" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink">Content & Drafts</h2>
            <p className="mt-1 text-xs text-ink-secondary">Your LinkedIn content pipeline</p>
          </div>
          <span className="rounded-md border border-border bg-surface px-2.5 py-1 text-[10px] font-medium text-ink-secondary">
            Sample workspace
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border pb-2">
          {[
            ["all", "All Posts"],
            ["draft", "Drafts"],
            ["needs_review", "Needs Review"],
            ["approved", "Approved"],
          ].map(([key, label]) => (
            <span
              key={key}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                key === "all"
                  ? "bg-forest text-white"
                  : "text-ink-secondary"
              }`}
            >
              {label}
            </span>
          ))}
        </div>
        <div className="grid gap-3">
          {filteredPosts.slice(0, 3).map((post) => (
            <article key={post.id} className="card flex flex-col gap-3 p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2">
                {getStatusBadge(post.status)}
                {post.pillar && (
                  <span className="rounded bg-forest-light px-2 py-0.5 text-xs font-medium text-forest">
                    {post.pillar}
                  </span>
                )}
                <span className="text-xs text-ink-secondary">
                  v{post.version} · {new Date(post.updated_at).toLocaleDateString()}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-ink">
                {post.internal_title ?? "Untitled Post"}
              </h3>
              <p className="line-clamp-3 whitespace-pre-line text-xs leading-relaxed text-ink/90">
                {post.text}
              </p>
              <div className="flex items-center justify-between border-t border-border/60 pt-2 text-xs">
                <span className="text-ink-secondary">{post.text.length} / 3000 chars</span>
                <span className="font-medium text-forest">
                  {post.status === "draft"
                    ? "Submit for Review"
                    : post.status === "needs_review"
                      ? "Awaiting approval"
                      : "Approved"}
                </span>
              </div>
            </article>
          ))}
        </div>
        <p className="text-[10px] text-ink-muted">
          Illustrative records · Same content workflow as the Nunuza workspace
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top action bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-ink">Content & Drafts</h1>
          <p className="text-sm text-ink-secondary">
            Manage your personal LinkedIn pipeline. Create, review, and publish from one place.
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

          <MediaPostComposer
            editPost={editingMediaPost}
            onEditClose={() => setEditingMediaPost(null)}
            onCreated={(post) => setPosts((prev) => prev.some((item) => item.id === post.id) ? prev.map((item) => item.id === post.id ? post : item) : [post, ...prev])}
          />
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
        {isPrivateBeta ? (
          <div className="flex items-center gap-1.5 text-forest font-medium">
            <Sparkles size={12} className="text-forest" />
            <span>Private Beta — Full Access. Human approval required before publishing.</span>
          </div>
        ) : canPublishPosts ? (
          <div className="flex items-center gap-1.5 text-forest font-medium">
            <CheckCircle2 size={12} className="text-forest" />
            <span>Publishing & scheduling active ({workspace.entitlement_type === "paid_trial" ? "14-Day Trial" : "Nunuza Solo"}).</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-ink-secondary">
            <Lock size={12} className="text-amber-600" />
            <span>Publishing & scheduling require an active 14-day free trial ($29/mo).</span>
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
          { key: "rejected", label: "Rejected" },
          { key: "failed", label: "Failed" },
          { key: "needs_reconciliation", label: "Check LinkedIn" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${filter === tab.key
              ? "bg-forest text-white"
              : "text-ink-secondary hover:text-ink hover:bg-forest-light/50"
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Action / Publish Feedback Banner */}
      {publishFeedback && (
        <div
          className={`p-3.5 rounded-lg border text-xs flex items-center justify-between transition-all ${
            publishFeedback.type === "success"
              ? "bg-forest-light border-forest/30 text-forest"
              : "bg-error/10 border-error/30 text-error"
          }`}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2">
            {publishFeedback.type === "success" ? (
              <CheckCircle2 size={16} className="shrink-0 text-forest" />
            ) : (
              <AlertCircle size={16} className="shrink-0 text-error" />
            )}
            <span className="font-medium">{publishFeedback.message}</span>
          </div>
          <button
            onClick={() => setPublishFeedback(null)}
            className="text-ink-secondary hover:text-ink text-xs font-semibold ml-4 p-1 rounded hover:bg-black/5"
            aria-label="Dismiss message"
          >
            <X size={14} />
          </button>
        </div>
      )}

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
                  {post.post_format && post.post_format !== "text" && (
                    <button
                      onClick={() => setEditingMediaPost(post)}
                      className="p-1.5 text-ink-secondary hover:text-forest rounded hover:bg-forest-light"
                      title="Edit slides or document"
                      aria-label="Edit slides or document"
                    >
                      <FileImage size={15} />
                    </button>
                  )}
                  <button
                    onClick={() => handleDeletePost(post.id)}
                    className="p-1.5 text-ink-secondary hover:text-error rounded hover:bg-error-light transition-colors"
                    title="Delete post"
                    aria-label="Delete post"
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
                      onClick={() => handleUpdatePost({ status: "needs_review" }, post)}
                      className="text-forest hover:underline font-medium text-xs"
                    >
                      Submit for Review
                    </button>
                  )}
                  {post.status === "needs_review" && (
                    canPublishPosts ? (
                      <button
                        onClick={() => handleUpdatePost({ status: "approved" }, post)}
                        className="text-forest hover:underline font-medium text-xs font-semibold"
                      >
                        Approve
                      </button>
                    ) : (
                      <span
                        className="text-ink-secondary flex items-center gap-1 cursor-not-allowed"
                        title="Approval for publishing requires an active trial or subscription"
                      >
                        <Lock size={11} /> Approval Gated
                      </span>
                    )
                  )}
                  {(post.status === "failed" || post.status === "rejected") && (
                    <button
                      onClick={() => handleUpdatePost({ status: "needs_review" }, post)}
                      className="text-forest hover:underline font-medium text-xs"
                    >
                      Return to Review
                    </button>
                  )}
                  {post.status === "approved" && (
                    canPublishPosts ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handlePublishNow(post)}
                          disabled={publishingPostId !== null}
                          className="btn-primary text-xs flex items-center gap-1.5 py-1 px-2.5 font-medium disabled:opacity-50"
                          title="Publish immediately to LinkedIn"
                        >
                          {publishingPostId === post.id ? (
                            <>
                              <Loader2 size={12} className="animate-spin" />
                              <span>Publishing...</span>
                            </>
                          ) : (
                            <>
                              <Send size={12} />
                              <span>Publish Now</span>
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => handleOpenSchedule(post)}
                          disabled={publishingPostId !== null}
                          className="btn-secondary text-xs flex items-center gap-1.5 py-1 px-2.5 text-forest hover:bg-forest-light border-forest/30 font-medium disabled:opacity-50"
                        >
                          <Calendar size={12} /> Schedule
                        </button>
                      </div>
                    ) : (
                      <span
                        className="text-ink-secondary flex items-center gap-1 cursor-not-allowed"
                        title="Publishing and scheduling require an active trial or subscription"
                      >
                        <Lock size={11} /> Publishing Gated
                      </span>
                    )
                  )}
                  {post.status === "scheduled" && (
                    <div className="flex items-center gap-2">
                      <span className="text-ink-secondary text-xs flex items-center gap-1">
                        <Clock size={11} className="text-forest" />
                        {post.scheduled_at ? new Date(post.scheduled_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Scheduled"}
                      </span>
                      <button
                        onClick={() => handleCancelSchedule(post.id)}
                        className="text-error hover:underline text-xs font-medium"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  {post.status === "needs_reconciliation" && (
                    <div className="flex flex-col gap-1.5 max-w-xs">
                      <p className="text-ink-secondary text-xs">
                        LinkedIn didn&apos;t confirm this post. Check your LinkedIn profile, then tell us what you see.
                      </p>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleReconcile(post, "published")}
                          disabled={reconcilingPostId !== null}
                          className="btn-primary text-xs flex items-center gap-1.5 py-1 px-2.5 font-medium disabled:opacity-50"
                        >
                          {reconcilingPostId === post.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <CheckCircle2 size={12} />
                          )}
                          <span>It&apos;s live</span>
                        </button>
                        <button
                          onClick={() => handleReconcile(post, "not_published")}
                          disabled={reconcilingPostId !== null}
                          className="btn-secondary text-xs py-1 px-2.5 font-medium disabled:opacity-50"
                        >
                          It&apos;s not live
                        </button>
                      </div>
                    </div>
                  )}
                  {post.status === "published" && (
                    <div className="flex items-center gap-1 text-success font-medium text-xs">
                      <CheckCircle2 size={12} /> Published
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* AI Generation Modal */}
      {isAiModalOpen && (
        <div className="fixed inset-0 z-50 bg-ink/30 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="ai-modal-title">
          <div className="card max-w-lg w-full p-6 shadow-xl animate-fade-in">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-forest-light flex items-center justify-center">
                  <Sparkles size={16} className="text-forest" />
                </div>
                <h2 id="ai-modal-title" className="text-base font-bold text-ink">Generate LinkedIn Draft</h2>
              </div>
              <button
                onClick={() => setIsAiModalOpen(false)}
                className="p-1.5 rounded-lg text-ink-secondary hover:bg-surface hover:text-ink transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {generationError && (
              <div className="mb-4 notice-error flex items-start gap-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5 text-error" />
                <span className="text-sm text-error">{generationError}</span>
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
        <div className="fixed inset-0 z-50 bg-ink/30 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="manual-modal-title">
          <div className="card max-w-lg w-full p-6 shadow-xl animate-fade-in">
            <div className="flex items-center justify-between mb-5">
              <h2 id="manual-modal-title" className="text-base font-bold text-ink">New Manual Draft</h2>
              <button
                onClick={() => setIsManualModalOpen(false)}
                className="p-1.5 rounded-lg text-ink-secondary hover:bg-surface hover:text-ink transition-colors"
                aria-label="Close"
              >
                <X size={18} />
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
        <div className="fixed inset-0 z-50 bg-ink/30 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="edit-modal-title">
          <div className="card max-w-xl w-full p-6 shadow-xl animate-fade-in">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 id="edit-modal-title" className="text-base font-bold text-ink">Edit Post</h2>
                <span className="text-xs text-ink-muted">Version {editingPost.version}</span>
              </div>
              <button
                onClick={() => setEditingPost(null)}
                className="p-1.5 rounded-lg text-ink-secondary hover:bg-surface hover:text-ink transition-colors"
                aria-label="Close"
              >
                <X size={18} />
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

              <PostImageGenerator
                postId={editingPost.id}
                imagePath={editingPost.image_path ?? null}
                onImageUpdated={(imagePath, status) => {
                  setEditingPost((current) => current ? { ...current, image_path: imagePath, status: status as PostStatus } : current);
                  setPosts((current) => current.map((post) =>
                    post.id === editingPost.id ? { ...post, image_path: imagePath, status: status as PostStatus } : post
                  ));
                }}
              />

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => handleDeletePost(editingPost.id)}
                  className="btn-danger flex items-center gap-1.5"
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

      {/* In-app confirmation for destructive actions */}
      {confirmation && (
        <div className="fixed inset-0 z-[60] bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card max-w-md w-full p-6 shadow-xl animate-fade-in" role="alertdialog" aria-modal="true" aria-labelledby="action-confirm-title" aria-describedby="action-confirm-description">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 shrink-0 rounded-full bg-error/10 flex items-center justify-center"><AlertCircle size={19} className="text-error" /></div>
              <div className="min-w-0">
                <h2 id="action-confirm-title" className="text-base font-bold text-ink">{confirmation.type === "delete" ? "Delete this post?" : "Cancel scheduled publication?"}</h2>
                <p id="action-confirm-description" className="mt-1.5 text-sm text-ink-secondary">{confirmation.type === "delete" ? "This post will be removed from your active content list. Its record remains stored for audit history and will not be permanently erased." : "The scheduled publishing job will be canceled. The post will remain in your content list."}</p>
              </div>
            </div>
            {publishFeedback?.type === "error" && <p className="mt-4 text-sm text-error" role="alert">{publishFeedback.message}</p>}
            <div className="flex items-center justify-end gap-2.5 mt-6">
              <button type="button" disabled={isConfirmingAction} onClick={() => setConfirmation(null)} className="btn-ghost text-xs">Keep post</button>
              <button type="button" disabled={isConfirmingAction} onClick={handleConfirmAction} className="btn-danger text-xs min-w-28 flex items-center justify-center gap-2 disabled:opacity-60">
                {isConfirmingAction ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}{isConfirmingAction ? "Processing..." : confirmation.type === "delete" ? "Delete post" : "Cancel schedule"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Modal */}
      {schedulingPost && (
        <div className="fixed inset-0 z-50 bg-ink/30 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="schedule-modal-title">
          <div className="card max-w-md w-full p-6 shadow-xl animate-fade-in">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-forest-light flex items-center justify-center">
                  <Calendar size={16} className="text-forest" />
                </div>
                <h2 id="schedule-modal-title" className="text-base font-bold text-ink">Schedule for LinkedIn</h2>
              </div>
              <button
                onClick={() => setSchedulingPost(null)}
                className="p-1.5 rounded-lg text-ink-secondary hover:bg-surface hover:text-ink transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {scheduleError && (
              <div className="mb-4 notice-error flex items-start gap-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5 text-error" />
                <span className="text-sm text-error">{scheduleError}</span>
              </div>
            )}

            <form onSubmit={handleScheduleSubmit} className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-ink mb-1">
                  Post to schedule:
                </p>
                <p className="text-xs text-ink-secondary bg-surface p-2.5 rounded border border-border line-clamp-3">
                  {schedulingPost.text}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink mb-1">
                  Publication Date &amp; Time (Local) *
                </label>
                <input
                  type="datetime-local"
                  required
                  value={scheduledDateTime}
                  onChange={(e) => setScheduledDateTime(e.target.value)}
                  className="input-field text-sm"
                />
                <p className="text-[11px] text-ink-secondary mt-1">
                  Cap: max 1 post per calendar day and 7 posts per rolling 7 days.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setSchedulingPost(null)}
                  className="btn-ghost text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isScheduling || !scheduledDateTime}
                  className="btn-primary text-xs flex items-center gap-1.5"
                >
                  {isScheduling ? "Scheduling..." : "Confirm Schedule"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
