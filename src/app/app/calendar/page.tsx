import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, AuthError } from "@/lib/auth/workspace";
import type { ContentPost } from "@/types/database";
import {
  Calendar as CalendarIcon,
  Clock,
  Lock,
  ArrowRight,
  FileText,
  AlertCircle,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Planning Calendar — Nunuza",
  robots: { index: false, follow: false },
};

export default async function CalendarPage() {
  let workspace;
  try {
    workspace = await requireWorkspace();
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    redirect("/app/onboarding");
  }

  const supabase = await createClient();

  let posts: ContentPost[] = [];
  let queryError: string | null = null;

  try {
    const { data, error } = await supabase
      .from("content_posts")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("updated_at", { ascending: false });

    if (error) throw new Error(error.message);
    posts = (data ?? []) as ContentPost[];
  } catch (err: unknown) {
    queryError = err instanceof Error ? err.message : "Failed to load posts.";
  }

  const scheduledPosts = posts.filter((p) => Boolean(p.scheduled_at));
  const otherDrafts = posts.filter((p) => !p.scheduled_at);

  return (
    <div className="max-w-4xl mx-auto animate-fade-in pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">Planning Calendar</h1>
          <p className="text-sm text-ink-secondary mt-1">
            Review your posting cadence, scheduled drafts, and upcoming publication targets.
          </p>
        </div>
        <Link href="/app/content" className="btn-primary text-xs flex items-center gap-1.5 self-start">
          <FileText size={14} />
          <span>Manage Drafts</span>
        </Link>
      </div>

      {/* Private Beta Notice */}
      {(workspace.entitlement_type === "internal_beta") && (
        <div className="notice-info mb-6">
          <Clock size={15} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Private Beta — Publishing &amp; Scheduling Active</p>
            <p className="mt-0.5">
              Scheduled drafts are queued for automated publication to your connected LinkedIn profile. Rate limits enforced: max 1 post per calendar day, 7 posts per rolling 7 days.
            </p>
          </div>
        </div>
      )}

      {/* Subscription Notice */}
      {(workspace.entitlement_type === "paid_trial" || workspace.entitlement_type === "paid_active") && (
        <div className="notice-info mb-6">
          <Clock size={15} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Automated Scheduling Active</p>
            <p className="mt-0.5">
              Scheduled posts publish automatically to your connected LinkedIn profile at the appointed time.
            </p>
          </div>
        </div>
      )}

      {/* Commercial Trial Required Notice */}
      {(workspace.entitlement_type === "draft_only" || workspace.entitlement_type === "suspended" || workspace.entitlement_type === "expired") && (
        <div className="notice-warning mb-6">
          <Lock size={15} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Automated Publishing Gated</p>
            <p className="mt-0.5">
              Start your 14-day free trial (\$29/mo) to enable automatic background publishing.
            </p>
          </div>
        </div>
      )}

      {queryError ? (
        <div className="card p-6 border-error-light bg-error-light/30">
          <div className="flex items-center gap-2 text-error font-semibold text-sm">
            <AlertCircle size={18} />
            <span>Database Error</span>
          </div>
          <p className="text-xs text-ink-secondary mt-1">{queryError}</p>
        </div>
      ) : posts.length === 0 ? (
        <div className="card p-10 text-center">
          <CalendarIcon size={32} className="mx-auto text-ink-secondary/50 mb-3" />
          <h3 className="text-base font-semibold text-ink">No Scheduled or Planned Drafts</h3>
          <p className="text-sm text-ink-secondary mt-1 max-w-md mx-auto">
            You do not have any drafts created yet. Create a draft in Content & Drafts to start planning your cadence.
          </p>
          <div className="mt-4">
            <Link href="/app/content" className="btn-secondary text-xs inline-flex items-center gap-1.5">
              <span>Go to Content & Drafts</span>
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Scheduled Drafts */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
              <Clock size={16} className="text-forest" />
              <span>Drafts with Target Dates ({scheduledPosts.length})</span>
            </h2>

            {scheduledPosts.length === 0 ? (
              <p className="text-xs text-ink-secondary">
                No drafts currently have a target date assigned.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {scheduledPosts.map((post) => (
                  <div key={post.id} className="py-3 flex items-center justify-between text-xs">
                    <div>
                      <p className="font-medium text-ink">
                        {post.internal_title || post.text.slice(0, 60) + "..."}
                      </p>
                      <p className="text-[11px] text-ink-secondary mt-0.5">
                        {post.pillar ? `Pillar: ${post.pillar} · ` : ""}
                        Target: {new Date(post.scheduled_at!).toLocaleDateString()}
                      </p>
                    </div>
                    <span className="badge-draft-only text-[10px] uppercase font-mono">
                      {post.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Unscheduled Drafts in Pipeline */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
              <FileText size={16} className="text-ink-secondary" />
              <span>Pipeline Drafts ({otherDrafts.length})</span>
            </h2>

            {otherDrafts.length === 0 ? (
              <p className="text-xs text-ink-secondary">
                All drafts have scheduled dates.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {otherDrafts.slice(0, 10).map((post) => (
                  <div key={post.id} className="py-3 flex items-center justify-between text-xs">
                    <div>
                      <p className="font-medium text-ink">
                        {post.internal_title || post.text.slice(0, 60) + "..."}
                      </p>
                      <p className="text-[11px] text-ink-secondary mt-0.5">
                        {post.pillar ? `Pillar: ${post.pillar} · ` : ""}
                        Updated: {new Date(post.updated_at).toLocaleDateString()}
                      </p>
                    </div>
                    <span className="badge-draft-only text-[10px] uppercase font-mono">
                      {post.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
