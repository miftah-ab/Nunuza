import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, AuthError } from "@/lib/auth/workspace";
import {
  BarChart2,
  CheckCircle2,
  Clock,
  FileText,
  Target,
  Sparkles,
  Calendar,
  Info,
  TrendingUp,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Performance & Publishing Velocity — Nunuza",
  robots: { index: false, follow: false },
};

export default async function PerformancePage() {
  let workspace;
  try {
    workspace = await requireWorkspace();
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    redirect("/app/onboarding");
  }

  const supabase = await createClient();

  // ─── 1. Query Real Workspace Content Performance ─────────────────────────────
  let publishedCount = 0;
  let scheduledCount = 0;
  let pipelineCount = 0;
  let totalCount = 0;
  let publishedThisWeek = 0;
  let recentPublished: Array<{
    id: string;
    title: string | null;
    pillar: string | null;
    status: string;
    updated_at: string;
  }> = [];
  const pillarCounts: Record<string, number> = {};

  let weeklyTarget = 3;

  try {
    // Start of current week (Monday)
    const now = new Date();
    const dayOfWeek = (now.getDay() + 6) % 7; // 0 = Monday, 6 = Sunday
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - dayOfWeek);
    startOfWeek.setHours(0, 0, 0, 0);

    const [allPostsRes, publishedWeekRes, recentPubRes, strategyRes] = await Promise.all([
      supabase
        .from("content_posts")
        .select("id, status, pillar")
        .eq("workspace_id", workspace.id),
      supabase
        .from("content_posts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspace.id)
        .eq("status", "published")
        .gte("updated_at", startOfWeek.toISOString()),
      supabase
        .from("content_posts")
        .select("id, title, pillar, status, updated_at")
        .eq("workspace_id", workspace.id)
        .eq("status", "published")
        .order("updated_at", { ascending: false })
        .limit(5),
      supabase
        .from("content_strategies")
        .select("cadence_per_week")
        .eq("workspace_id", workspace.id)
        .maybeSingle(),
    ]);

    if (strategyRes.data?.cadence_per_week) {
      weeklyTarget = strategyRes.data.cadence_per_week;
    }

    const posts = allPostsRes.data || [];
    totalCount = posts.length;

    posts.forEach((p) => {
      if (p.status === "published") publishedCount++;
      else if (p.status === "scheduled") scheduledCount++;
      else pipelineCount++;

      const pillarName = p.pillar || "Uncategorized";
      pillarCounts[pillarName] = (pillarCounts[pillarName] || 0) + 1;
    });

    publishedThisWeek = publishedWeekRes.count ?? 0;
    recentPublished = (recentPubRes.data || []) as any;
  } catch {
    // Non-fatal fallback
  }

  const cadencePercentage = Math.min(100, Math.round((publishedThisWeek / weeklyTarget) * 100));

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in pb-12">
      {/* ─── Page Header ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold text-ink">Publishing Velocity &amp; Analytics</h1>
          <p className="text-xs text-ink-secondary mt-1">
            Tracking execution velocity, cadence adherence, and editorial distribution for {workspace.name}.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Link
            href="/app/calendar"
            className="btn-secondary text-xs flex items-center gap-1.5"
          >
            <Calendar size={14} />
            <span>Publishing Calendar</span>
          </Link>
          <Link
            href="/app/content"
            className="btn-primary text-xs flex items-center gap-1.5"
          >
            <Sparkles size={14} />
            <span>Create Draft</span>
          </Link>
        </div>
      </div>

      {/* ─── LinkedIn API Analytics Scope Notice ─── */}
      <div className="card p-4 bg-surface border border-border">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded bg-white border border-border text-forest shrink-0">
            <ShieldCheck size={18} />
          </div>
          <div className="text-xs">
            <p className="font-semibold text-ink">
              Direct LinkedIn Personal-Profile Publishing Architecture
            </p>
            <p className="text-ink-secondary mt-1 leading-relaxed">
              Nunuza publishes directly to your personal LinkedIn profile using LinkedIn&apos;s official <code className="px-1 py-0.5 rounded bg-surface-alt font-mono text-ink">w_member_social</code> scope. Personal post analytics use a separate LinkedIn Community Management permission, <code className="px-1 py-0.5 rounded bg-surface-alt font-mono text-ink">r_member_postAnalytics</code>. That permission is not currently granted to this app, so impressions, reactions, comments, and reach are unavailable here. Nunuza will not invent those numbers. This page reports verified operational velocity, publishing cadence, and content distribution from your workspace data.
            </p>
          </div>
        </div>
      </div>

      {/* ─── 4-Metric Grid ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Published Posts */}
        <div className="card p-4">
          <div className="flex items-center justify-between text-ink-secondary mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Published</span>
            <CheckCircle2 size={16} className="text-forest" />
          </div>
          <p className="text-3xl font-bold text-ink">{publishedCount}</p>
          <p className="text-[11px] text-ink-secondary mt-1">
            Live publications on your LinkedIn profile.
          </p>
        </div>

        {/* Metric 2: Weekly Cadence Adherence */}
        <div className="card p-4">
          <div className="flex items-center justify-between text-ink-secondary mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Weekly Pacing</span>
            <TrendingUp size={16} className="text-forest" />
          </div>
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-bold text-ink">{publishedThisWeek}</p>
            <span className="text-xs text-ink-secondary">/ {weeklyTarget} target</span>
          </div>
          <div className="w-full bg-surface-alt rounded-full h-1.5 mt-2 overflow-hidden">
            <div
              className="bg-forest h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${cadencePercentage}%` }}
            />
          </div>
          <p className="text-[11px] text-ink-secondary mt-1">
            {cadencePercentage}% of weekly target published this week.
          </p>
        </div>

        {/* Metric 3: Scheduled Queue */}
        <div className="card p-4">
          <div className="flex items-center justify-between text-ink-secondary mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Scheduled Queue</span>
            <Clock size={16} className="text-forest" />
          </div>
          <p className="text-3xl font-bold text-ink">{scheduledCount}</p>
          <p className="text-[11px] text-ink-secondary mt-1">
            Posts queued for automated publication.
          </p>
        </div>

        {/* Metric 4: Total Pipeline */}
        <div className="card p-4">
          <div className="flex items-center justify-between text-ink-secondary mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider">Content Pipeline</span>
            <FileText size={16} className="text-forest" />
          </div>
          <p className="text-3xl font-bold text-ink">{pipelineCount}</p>
          <p className="text-[11px] text-ink-secondary mt-1">
            Drafts in review, editing, or approved state.
          </p>
        </div>
      </div>

      {/* ─── Two-Column Analytical Breakdown ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Content Pillar Distribution */}
        <div className="card p-5">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-border">
            <div className="flex items-center gap-2">
              <Target size={16} className="text-forest" />
              <h2 className="text-sm font-semibold text-ink">Editorial Pillar Distribution</h2>
            </div>
            <Link
              href="/app/strategy"
              className="text-xs font-semibold text-forest hover:text-forest-hover flex items-center gap-1"
            >
              Strategy <ArrowRight size={13} />
            </Link>
          </div>

          {Object.keys(pillarCounts).length === 0 ? (
            <div className="py-8 text-center text-xs text-ink-secondary">
              <p>No content generated yet to calculate distribution.</p>
              <p className="text-[11px] mt-1 text-ink-secondary/70">
                Generate drafts to track balance across your strategic pillars.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(pillarCounts).map(([pillar, count]) => {
                const pct = totalCount > 0 ? Math.round((count / totalCount) * 100) : 0;
                return (
                  <div key={pillar} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-ink truncate mr-2">{pillar}</span>
                      <span className="text-ink-secondary text-[11px] font-mono">
                        {count} ({pct}%)
                      </span>
                    </div>
                    <div className="w-full bg-surface rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-forest h-1.5 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Recent Publication Log */}
        <div className="card p-5">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-border">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-forest" />
              <h2 className="text-sm font-semibold text-ink">Recent Published Posts</h2>
            </div>
            <Link
              href="/app/content"
              className="text-xs font-semibold text-forest hover:text-forest-hover flex items-center gap-1"
            >
              Content Studio <ArrowRight size={13} />
            </Link>
          </div>

          {recentPublished.length === 0 ? (
            <div className="py-8 text-center text-xs text-ink-secondary">
              <p>No posts published yet from this workspace.</p>
              <p className="text-[11px] mt-1 text-ink-secondary/70">
                Scheduled posts publish automatically once their target publication slot arrives.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentPublished.map((post) => (
                <div
                  key={post.id}
                  className="p-3 rounded-lg bg-surface border border-border flex items-center justify-between text-xs"
                >
                  <div className="min-w-0 flex-1 mr-3">
                    <p className="font-semibold text-ink truncate">
                      {post.title || "Untitled published post"}
                    </p>
                    <p className="text-[11px] text-ink-secondary mt-0.5">
                      <span className="text-forest font-medium">{post.pillar || "General"}</span> &bull;{" "}
                      {new Date(post.updated_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <span className="badge-active shrink-0 text-[10px]">
                    Published
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
