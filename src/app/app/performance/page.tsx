import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, AuthError } from "@/lib/auth/workspace";
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Info,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Publishing Performance — Nunuza",
  robots: { index: false, follow: false },
};

const PIPELINE_STATUSES = [
  "draft",
  "needs_review",
  "approved",
  "publishing",
  "needs_reconciliation",
] as const;

function getDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

/** Convert a workspace-local calendar date at midnight into its UTC instant. */
function zonedMidnightToUtc(year: number, month: number, day: number, timeZone: string) {
  const desiredUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  let candidate = desiredUtc;

  // Two passes account for the timezone offset at the target date, including DST.
  for (let i = 0; i < 2; i++) {
    const local = getDateParts(new Date(candidate), timeZone);
    const representedUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second
    );
    candidate = desiredUtc - (representedUtc - candidate);
  }

  return new Date(candidate);
}

function getWorkspaceWeekStart(timeZone: string) {
  const now = new Date();
  const local = getDateParts(now, timeZone);
  const localDate = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const daysSinceMonday = (localDate.getUTCDay() + 6) % 7;
  localDate.setUTCDate(localDate.getUTCDate() - daysSinceMonday);

  return zonedMidnightToUtc(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth() + 1,
    localDate.getUTCDate(),
    timeZone
  ).toISOString();
}

function getNinetyDaysAgo() {
  return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
}

function isLinkedInConnectionActive(connection: { status: string; expires_at: string | null } | null | undefined) {
  return connection?.status === "connected" &&
    (!connection.expires_at || new Date(connection.expires_at).getTime() > Date.now());
}

function safeTimeZone(value: string | null | undefined) {
  if (!value) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function PerformancePage() {
  let workspace;
  try {
    workspace = await requireWorkspace();
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    redirect("/app/onboarding");
  }

  const supabase = await createClient();

  const [strategyRes, connectionRes] = await Promise.all([
    supabase
      .from("content_strategies")
      .select("cadence_per_week, timezone")
      .eq("workspace_id", workspace.id)
      .maybeSingle(),
    supabase
      .from("integration_connections")
      .select("status, granted_scopes, expires_at")
      .eq("workspace_id", workspace.id)
      .eq("provider", "linkedin")
      .maybeSingle(),
  ]);

  const timeZone = safeTimeZone(strategyRes.data?.timezone);
  const weekStart = getWorkspaceWeekStart(timeZone);
  const ninetyDaysAgo = getNinetyDaysAgo();

  const [
    publishedRes,
    scheduledRes,
    pipelineRes,
    weeklyRes,
    recentRes,
    pillarsRes,
  ] = await Promise.all([
    supabase
      .from("content_posts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .eq("status", "published"),
    supabase
      .from("content_posts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .eq("status", "scheduled"),
    supabase
      .from("content_posts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .in("status", [...PIPELINE_STATUSES]),
    supabase
      .from("content_posts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .eq("status", "published")
      .not("published_at", "is", null)
      .gte("published_at", weekStart),
    supabase
      .from("content_posts")
      .select("id, internal_title, pillar, published_at, linkedin_post_id")
      .eq("workspace_id", workspace.id)
      .eq("status", "published")
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(5),
    supabase
      .from("content_posts")
      .select("pillar")
      .eq("workspace_id", workspace.id)
      .eq("status", "published")
      .not("published_at", "is", null)
      .gte("published_at", ninetyDaysAgo)
      .order("published_at", { ascending: false })
      .limit(500),
  ]);

  const queryErrors = [
    strategyRes.error,
    connectionRes.error,
    publishedRes.error,
    scheduledRes.error,
    pipelineRes.error,
    weeklyRes.error,
    recentRes.error,
    pillarsRes.error,
  ].filter(Boolean);

  if (queryErrors.length > 0) {
    console.error("[performance] Failed to load workspace metrics:", queryErrors);
  }

  const hasDataError = queryErrors.length > 0;
  const publishedCount = publishedRes.count ?? 0;
  const scheduledCount = scheduledRes.count ?? 0;
  const pipelineCount = pipelineRes.count ?? 0;
  const publishedThisWeek = weeklyRes.count ?? 0;
  const weeklyTarget = strategyRes.data?.cadence_per_week ?? 3;
  const cadencePercentage = weeklyTarget > 0
    ? Math.min(100, Math.round((publishedThisWeek / weeklyTarget) * 100))
    : 0;

  const recentPublished = recentRes.data ?? [];
  const pillarCounts: Record<string, number> = {};
  for (const post of pillarsRes.data ?? []) {
    const pillar = post.pillar?.trim() || "Unassigned";
    pillarCounts[pillar] = (pillarCounts[pillar] ?? 0) + 1;
  }
  const pillarTotal = Object.values(pillarCounts).reduce((sum, count) => sum + count, 0);

  const connection = connectionRes.data;
  const isLinkedInConnected = isLinkedInConnectionActive(connection);
  const hasPublishScope = Array.isArray(connection?.granted_scopes) &&
    connection.granted_scopes.includes("w_member_social");

  const nextStep = publishedThisWeek >= weeklyTarget
    ? "Your publishing target is met. Keep the next scheduled posts ready and review the results on LinkedIn."
    : scheduledCount > 0
      ? "You are below your weekly target. Keep the scheduled queue healthy and let confirmed publications count toward the target."
      : "You are below your weekly target and have no scheduled posts. Prepare and schedule the next approved post.";

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold text-ink">Publishing Performance</h1>
          <p className="text-xs text-ink-secondary mt-1">
            Verified publishing activity and cadence for {workspace.name}.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Link href="/app/calendar" className="btn-secondary text-xs flex items-center gap-1.5">
            <Calendar size={14} />
            <span>Publishing Calendar</span>
          </Link>
          <Link href="/app/content" className="btn-primary text-xs flex items-center gap-1.5">
            <Sparkles size={14} />
            <span>Create Draft</span>
          </Link>
        </div>
      </div>

      <section className="card p-4 border border-border bg-surface">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded bg-white border border-border text-forest shrink-0">
            <ShieldCheck size={18} />
          </div>
          <div className="min-w-0 text-xs">
            <p className="font-semibold text-ink">LinkedIn audience analytics are not collected yet</p>
            <p className="text-ink-secondary mt-1 leading-relaxed">
              The current LinkedIn connection is built for publishing with the official
              <code className="px-1 py-0.5 rounded bg-surface-alt font-mono text-ink">w_member_social</code>
              permission. Nunuza does not currently run an official post-analytics collection flow,
              so impressions, reactions, comments, shares, and engagement rates are not available
              here. This page will not estimate or invent them.
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11px]">
              <span className="text-ink-secondary">
                LinkedIn connection: <strong className="text-ink">{isLinkedInConnected ? "Connected" : "Not connected / expired"}</strong>
              </span>
              <span className="text-ink-secondary">
                Publishing permission: <strong className="text-ink">{hasPublishScope ? "Granted" : "Not detected"}</strong>
              </span>
              <Link href="/app/integrations" className="text-forest font-semibold hover:underline inline-flex items-center gap-1">
                Integration settings <ArrowRight size={12} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {hasDataError ? (
        <section className="card p-5 border border-border" role="alert">
          <div className="flex items-start gap-3">
            <Info size={18} className="text-ink-secondary mt-0.5 shrink-0" />
            <div>
              <h2 className="text-sm font-semibold text-ink">Performance data could not be loaded</h2>
              <p className="text-xs text-ink-secondary mt-1">
                At least one workspace query failed. Metrics are hidden rather than showing misleading zero values.
                Refresh the page; if this continues, check the Activity page or contact support.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              label="Total Published"
              value={publishedCount}
              description="Posts confirmed as published in Nunuza."
              icon={<CheckCircle2 size={16} className="text-forest" />}
            />
            <MetricCard
              label="Published This Week"
              value={publishedThisWeek}
              suffix={`/ ${weeklyTarget} target`}
              description={`Workspace week · ${timeZone}`}
              icon={<TrendingUp size={16} className="text-forest" />}
              progress={cadencePercentage}
            />
            <MetricCard
              label="Scheduled Queue"
              value={scheduledCount}
              description="Posts currently in scheduled status."
              icon={<Clock size={16} className="text-forest" />}
            />
            <MetricCard
              label="Active Pipeline"
              value={pipelineCount}
              description="Draft, review, approved, publishing, or reconciliation."
              icon={<FileText size={16} className="text-forest" />}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="card p-5">
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <Target size={16} className="text-forest" />
                  <h2 className="text-sm font-semibold text-ink">Published Content Mix</h2>
                </div>
                <span className="text-[11px] text-ink-secondary">Last 90 days</span>
              </div>
              {pillarTotal === 0 ? (
                <div className="py-8 text-center text-xs text-ink-secondary">
                  No confirmed publications in the last 90 days.
                </div>
              ) : (
                <div className="space-y-3">
                  {Object.entries(pillarCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([pillar, count]) => {
                      const percentage = Math.round((count / pillarTotal) * 100);
                      return (
                        <div key={pillar} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-ink truncate mr-2">{pillar}</span>
                            <span className="text-ink-secondary text-[11px] font-mono">
                              {count} ({percentage}%)
                            </span>
                          </div>
                          <div className="w-full bg-surface-alt rounded-full h-1.5 overflow-hidden">
                            <div className="bg-forest h-1.5 rounded-full" style={{ width: `${percentage}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  {pillarsRes.data?.length === 500 ? (
                    <p className="text-[10px] text-ink-secondary">Showing the latest 500 published posts in this period.</p>
                  ) : null}
                </div>
              )}
            </section>

            <section className="card p-5">
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-forest" />
                  <h2 className="text-sm font-semibold text-ink">Recent Publications</h2>
                </div>
                <Link href="/app/content" className="text-xs font-semibold text-forest hover:text-forest-hover flex items-center gap-1">
                  Content Studio <ArrowRight size={13} />
                </Link>
              </div>
              {recentPublished.length === 0 ? (
                <div className="py-8 text-center text-xs text-ink-secondary">
                  No confirmed publications with a publication timestamp yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {recentPublished.map((post) => (
                    <div key={post.id} className="p-3 rounded-lg bg-surface border border-border flex items-center justify-between text-xs gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-ink truncate">
                          {post.internal_title || "Untitled published post"}
                        </p>
                        <p className="text-[11px] text-ink-secondary mt-0.5">
                          <span className="text-forest font-medium">{post.pillar || "Unassigned"}</span>
                          {" · "}
                          {formatDate(post.published_at, timeZone)}
                        </p>
                      </div>
                      <span className="badge-active shrink-0 text-[10px]">Published</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="card p-5">
            <div className="flex items-center gap-2 mb-2">
              <Target size={16} className="text-forest" />
              <h2 className="text-sm font-semibold text-ink">Operational Next Step</h2>
            </div>
            <p className="text-xs text-ink-secondary leading-relaxed">{nextStep}</p>
            <p className="text-[11px] text-ink-secondary mt-2">
              Based only on confirmed publication counts, your saved weekly cadence, and scheduled queue.
              This is an execution prompt, not a claim about audience engagement.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  suffix,
  description,
  icon,
  progress,
}: {
  label: string;
  value: number;
  suffix?: string;
  description: string;
  icon: React.ReactNode;
  progress?: number;
}) {
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between text-ink-secondary mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider">{label}</span>
        {icon}
      </div>
      <div className="flex items-baseline gap-2">
        <p className="text-3xl font-bold text-ink">{value}</p>
        {suffix ? <span className="text-xs text-ink-secondary">{suffix}</span> : null}
      </div>
      {typeof progress === "number" ? (
        <div className="w-full bg-surface-alt rounded-full h-1.5 mt-2 overflow-hidden">
          <div className="bg-forest h-1.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      <p className="text-[11px] text-ink-secondary mt-1">{description}</p>
    </section>
  );
}
