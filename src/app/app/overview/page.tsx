import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, AuthError } from "@/lib/auth/workspace";
import type { Workspace, AgentState } from "@/types/database";
import {
  CheckCircle2,
  AlertCircle,
  PauseCircle,
  WifiOff,
  AlertTriangle,
  FileText,
  Sparkles,
  ArrowRight,
  Activity as ActivityIcon,
  Calendar,
  Lock,
  Plus,
  Linkedin,
  Send,
  Cpu,
  Clock,
  ExternalLink,
  ShieldCheck,
  CheckCircle,
} from "lucide-react";
import { getTelegramLinkStatus } from "@/lib/integrations/telegram/service";
import { getMcpCredentialStatus } from "@/lib/integrations/mcp/tokens";

export const metadata: Metadata = {
  title: "Overview — Nunuza",
  robots: { index: false, follow: false },
};

interface StateDisplay {
  label: string;
  icon: typeof CheckCircle2;
  color: string;
  description: string;
}

const STATE_CONFIG: Record<AgentState, StateDisplay> = {
  setup_required: {
    label: "Setup required",
    icon: AlertCircle,
    color: "text-amber-600",
    description: "Initial setup is incomplete. Complete onboarding to activate your workspace.",
  },
  active_approval_required: {
    label: "Active — review needed",
    icon: CheckCircle2,
    color: "text-forest",
    description: "Content drafting is active. Generated posts require manual review before scheduling or export.",
  },
  active_autopilot: {
    label: "Active — autopilot",
    icon: CheckCircle2,
    color: "text-forest",
    description: "Autopilot is active. Posts are scheduled automatically according to your cadence bounds.",
  },
  paused: {
    label: "Paused",
    icon: PauseCircle,
    color: "text-ink-secondary",
    description: "Content generation and agent jobs are paused. Resume to continue.",
  },
  blocked_integration: {
    label: "Integration issue",
    icon: WifiOff,
    color: "text-error",
    description: "Integration connection issue requires your attention in Integrations.",
  },
  attention_required: {
    label: "Attention required",
    icon: AlertTriangle,
    color: "text-warning",
    description: "Workspace configuration or content pipeline requires review.",
  },
};

const ENTITLEMENT_BADGES: Record<string, { label: string; className: string }> = {
  internal_beta: {
    label: "Private Beta — Full Access",
    className: "badge-beta",
  },
  publishing_beta: {
    label: "Private Beta — Full Access",
    className: "badge-beta",
  },
  internal_test: {
    label: "Internal Beta — Full Access",
    className: "badge-beta",
  },
  paid_trial: {
    label: "14-Day Free Trial",
    className: "badge-active",
  },
  paid_active: {
    label: "Active Subscription ($29/mo)",
    className: "badge-active",
  },
  suspended: {
    label: "Subscription Suspended",
    className: "badge-error",
  },
  expired: {
    label: "Trial Expired",
    className: "badge-error",
  },
  draft_only: {
    label: "Commercial Onboarding",
    className: "badge-draft-only",
  },
  inactive: {
    label: "Inactive",
    className: "badge-error",
  },
};

interface RecentActivityItem {
  id: string;
  source: "audit" | "job";
  title: string;
  detail: string;
  timestamp: string;
  statusBadge?: { label: string; className: string };
}

interface PostSummary {
  id: string;
  title: string | null;
  pillar: string | null;
  status: string;
  scheduled_for?: string | null;
  updated_at?: string;
  created_at?: string;
}

export default async function OverviewPage() {
  let workspace: Workspace;

  try {
    workspace = await requireWorkspace();
  } catch (err) {
    if (err instanceof AuthError) {
      redirect("/login");
    }
    redirect("/app/onboarding");
  }

  // If setup is still required, redirect to onboarding wizard
  if (workspace.state === "setup_required") {
    redirect("/app/onboarding");
  }

  const supabase = await createClient();

  // ─── 1. Query Real Metrics (isolated strictly by workspace_id) ───────────────
  let draftsAwaitingReview: number | null = null;
  let approvedDrafts: number | null = null;
  let scheduledDrafts: number | null = null;
  let publishedDrafts: number | null = null;
  let totalDrafts: number | null = null;
  let draftsError: string | null = null;

  try {
    const [awaitingRes, approvedRes, scheduledRes, publishedRes, totalRes] = await Promise.all([
      supabase
        .from("content_posts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspace.id)
        .in("status", ["draft", "needs_review"]),
      supabase
        .from("content_posts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspace.id)
        .eq("status", "approved"),
      supabase
        .from("content_posts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspace.id)
        .eq("status", "scheduled"),
      supabase
        .from("content_posts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspace.id)
        .eq("status", "published"),
      supabase
        .from("content_posts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspace.id),
    ]);

    if (awaitingRes.error) throw new Error(awaitingRes.error.message);
    if (approvedRes.error) throw new Error(approvedRes.error.message);

    draftsAwaitingReview = awaitingRes.count ?? 0;
    approvedDrafts = approvedRes.count ?? 0;
    scheduledDrafts = scheduledRes.count ?? 0;
    publishedDrafts = publishedRes.count ?? 0;
    totalDrafts = totalRes.count ?? 0;
  } catch (err: unknown) {
    draftsError = err instanceof Error ? err.message : "Unable to query content drafts.";
  }

  // ─── 2. Query Operational Posts (Upcoming Scheduled & Drafts Needing Review) ───
  let upcomingPosts: PostSummary[] = [];
  let pendingReviewPosts: PostSummary[] = [];

  try {
    const [upcomingRes, pendingRes] = await Promise.all([
      supabase
        .from("content_posts")
        .select("id, title, pillar, status, scheduled_for, created_at")
        .eq("workspace_id", workspace.id)
        .eq("status", "scheduled")
        .order("scheduled_for", { ascending: true })
        .limit(3),
      supabase
        .from("content_posts")
        .select("id, title, pillar, status, updated_at, created_at")
        .eq("workspace_id", workspace.id)
        .in("status", ["draft", "needs_review"])
        .order("updated_at", { ascending: false })
        .limit(3),
    ]);

    if (!upcomingRes.error && upcomingRes.data) {
      upcomingPosts = upcomingRes.data as PostSummary[];
    }
    if (!pendingRes.error && pendingRes.data) {
      pendingReviewPosts = pendingRes.data as PostSummary[];
    }
  } catch {
    // Non-fatal query fallback
  }

  // ─── 3. Query Integration Health & Cadence ──────────────────────────────────
  let linkedinConnected = false;
  let linkedinProfileName: string | null = null;
  let telegramConnected = false;
  let mcpActive = false;
  let weeklyCadenceTarget = 3;

  try {
    const [linkedinData, telegramStatus, mcpStatus, strategyData] = await Promise.all([
      (async () => {
        try {
          const res = await supabase
            .from("integration_connections")
            .select("status, metadata")
            .eq("workspace_id", workspace.id)
            .eq("provider", "linkedin")
            .eq("status", "connected")
            .maybeSingle();
          return res.data;
        } catch {
          return null;
        }
      })(),
      getTelegramLinkStatus(workspace.id, supabase).catch(() => ({ linked: false })),
      getMcpCredentialStatus(workspace.id, supabase).catch(() => ({ active: false })),
      (async () => {
        try {
          const res = await supabase
            .from("content_strategies")
            .select("cadence_per_week")
            .eq("workspace_id", workspace.id)
            .maybeSingle();
          return res.data;
        } catch {
          return null;
        }
      })(),
    ]);

    if (linkedinData) {
      linkedinConnected = true;
      linkedinProfileName = (linkedinData.metadata as any)?.name || null;
    }
    telegramConnected = telegramStatus?.linked ?? false;
    mcpActive = mcpStatus?.active ?? false;
    if (strategyData?.cadence_per_week) {
      weeklyCadenceTarget = strategyData.cadence_per_week;
    }
  } catch {
    // Non-fatal integration health query
  }

  // ─── 4. Query Recent Activity (audit_events & agent_jobs) ────────────────────
  let recentActivities: RecentActivityItem[] = [];
  let activityError: string | null = null;

  try {
    const [auditRes, jobsRes] = await Promise.all([
      supabase
        .from("audit_events")
        .select("id, action, actor_type, resource_type, created_at")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("agent_jobs")
        .select("id, job_type, status, created_at, last_error_code")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    if (auditRes.error) throw new Error(auditRes.error.message);
    if (jobsRes.error) throw new Error(jobsRes.error.message);

    const auditItems: RecentActivityItem[] = (auditRes.data ?? []).map((a: any) => {
      const actionDisplay = a.action.replace(/_/g, " ");
      return {
        id: `audit-${a.id}`,
        source: "audit",
        title: actionDisplay.charAt(0).toUpperCase() + actionDisplay.slice(1),
        detail: `Actor: ${a.actor_type}${a.resource_type ? ` · ${a.resource_type}` : ""}`,
        timestamp: a.created_at,
        statusBadge: { label: "Logged", className: "badge-draft-only" },
      };
    });

    const jobItems: RecentActivityItem[] = (jobsRes.data ?? []).map((j: any) => {
      const typeDisplay = j.job_type.replace(/_/g, " ");
      let badgeClass = "badge-draft-only";
      if (j.status === "succeeded") badgeClass = "badge-active";
      else if (j.status === "failed_terminal" || j.status === "failed_retryable") badgeClass = "badge-error";
      else if (j.status === "running") badgeClass = "badge-beta";

      return {
        id: `job-${j.id}`,
        source: "job",
        title: `Job: ${typeDisplay}`,
        detail: `Status: ${j.status}${j.last_error_code ? ` (${j.last_error_code})` : ""}`,
        timestamp: j.created_at,
        statusBadge: { label: j.status, className: badgeClass },
      };
    });

    recentActivities = [...auditItems, ...jobItems]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 4);
  } catch (err: unknown) {
    activityError = err instanceof Error ? err.message : "Unable to query activity log.";
  }

  // ─── 5. State & Entitlement Badges ───────────────────────────────────────────
  const effectiveState: AgentState = workspace.paused_at ? "paused" : workspace.state;
  const stateConfig = STATE_CONFIG[effectiveState] ?? STATE_CONFIG.setup_required;
  const StateIcon = stateConfig.icon;
  const entitlementBadge = ENTITLEMENT_BADGES[workspace.entitlement_type] ?? {
    label: workspace.entitlement_type,
    className: "badge-draft-only",
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in pb-12">
      {/* ─── Top Operational Header ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-ink">Overview</h1>
            <span className={entitlementBadge.className}>{entitlementBadge.label}</span>
          </div>
          <p className="text-xs text-ink-secondary mt-1">
            {workspace.name} &bull; Operating Mode:{" "}
            <span className="font-semibold text-ink">
              {workspace.operating_mode === "approval_required" ? "Approval Required" : "Autopilot"}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Link
            href="/app/content"
            className="btn-primary text-xs flex items-center gap-1.5 shadow-xs"
          >
            <Plus size={15} />
            <span>Create Draft</span>
          </Link>
        </div>
      </div>

      {/* ─── Private Beta Full-Access Notice ─── */}
      {(workspace.entitlement_type === "internal_beta" || workspace.entitlement_type === "publishing_beta") && (
        <div className="card border-forest-muted bg-forest-light/40 p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded bg-white/80 border border-forest-muted text-forest shrink-0">
              <Sparkles size={17} />
            </div>
            <div>
              <p className="text-xs font-semibold text-ink">
                Private Beta — Full Access
              </p>
              <p className="text-xs text-ink-secondary mt-0.5 leading-relaxed">
                Your workspace is authorized for private beta testing with complete v1.0.0 features. You can generate drafts, schedule and publish to LinkedIn, use Telegram and MCP channels, and exercise Bounded Autopilot. No subscription required.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ─── Paid Trial Notice ─── */}
      {workspace.entitlement_type === "paid_trial" && (
        <div className="card border-forest-muted bg-forest-light/40 p-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded bg-white/80 border border-forest-muted text-forest shrink-0">
              <Sparkles size={17} />
            </div>
            <div>
              <p className="text-xs font-semibold text-ink">
                14-Day Free Trial — Full Access
              </p>
              <p className="text-xs text-ink-secondary mt-0.5 leading-relaxed">
                You have full v1.0.0 access across all publishing, scheduling, and automation tools during your 14-day trial. Automatic renewal at $29/month unless cancelled.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ─── Commercial Trial Activation Callout ─── */}
      {(workspace.entitlement_type === "suspended" || workspace.entitlement_type === "expired" || workspace.entitlement_type === "draft_only") && (
        <div className="card border-amber-200 bg-amber-50/50 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded bg-white border border-amber-200 text-amber-700 shrink-0">
                <Lock size={17} />
              </div>
              <div>
                <p className="text-xs font-semibold text-ink">
                  {workspace.entitlement_type === "expired" ? "Trial Expired" : "Start Your 14-Day Free Trial"}
                </p>
                <p className="text-xs text-ink-secondary mt-0.5 leading-relaxed max-w-xl">
                  Unlock LinkedIn personal-profile publishing, durable scheduling, Telegram/MCP controls, and Autopilot for $29/month (card required, cancel anytime).
                </p>
              </div>
            </div>
            <Link
              href="/app/billing"
              className="btn-primary text-xs whitespace-nowrap self-start sm:self-auto"
            >
              Start Free Trial
            </Link>
          </div>
        </div>
      )}

      {/* ─── First-Draft Callout when Workspace has 0 Posts ─── */}
      {!draftsError && totalDrafts === 0 && (
        <div className="card border-forest-muted bg-white p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles size={17} className="text-forest" />
                <h3 className="text-sm font-semibold text-ink">Ready for your first draft?</h3>
              </div>
              <p className="text-xs text-ink-secondary mt-1 max-w-xl">
                Your workspace strategy and voice settings are saved. Generate a post with AI using your pillars, or compose your own draft.
              </p>
            </div>
            <Link
              href="/app/content"
              className="btn-primary text-xs flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              <Sparkles size={14} />
              <span>Create First Draft</span>
            </Link>
          </div>
        </div>
      )}

      {/* ─── 4-Metric Operational Grid ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Drafts Awaiting Review */}
        <Link
          href="/app/content"
          className="card p-4 hover:border-forest/40 transition-colors flex flex-col justify-between group"
        >
          <div>
            <div className="flex items-center justify-between text-ink-secondary mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Awaiting Review</span>
              <FileText size={16} className="text-forest group-hover:scale-105 transition-transform" />
            </div>
            {draftsError ? (
              <div className="text-xs text-error">
                <p className="font-semibold">Query error</p>
                <p className="mt-0.5">{draftsError}</p>
              </div>
            ) : (
              <div>
                <p className="text-2xl font-bold text-ink">
                  {draftsAwaitingReview}
                </p>
                <p className="text-[11px] text-ink-secondary mt-1">
                  {draftsAwaitingReview === 0
                    ? "0 drafts currently waiting for review."
                    : `${draftsAwaitingReview} ${draftsAwaitingReview === 1 ? "draft" : "drafts"} ready for review & approval.`}
                </p>
                {approvedDrafts !== null && approvedDrafts > 0 && (
                  <p className="text-[11px] text-forest mt-0.5 font-medium">
                    {approvedDrafts} approved {approvedDrafts === 1 ? "draft" : "drafts"} available to export.
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="mt-3 pt-2 border-t border-border/60 flex items-center justify-between text-[11px] text-ink-secondary font-medium">
            <span>Review drafts</span>
            <ArrowRight size={13} className="text-forest group-hover:translate-x-0.5 transition-transform" />
          </div>
        </Link>

        {/* Metric 2: Scheduled Posts */}
        <Link
          href="/app/calendar"
          className="card p-4 hover:border-forest/40 transition-colors flex flex-col justify-between group"
        >
          <div>
            <div className="flex items-center justify-between text-ink-secondary mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Scheduled Posts</span>
              <Calendar size={16} className="text-forest group-hover:scale-105 transition-transform" />
            </div>
            <div>
              <p className="text-2xl font-bold text-ink">
                {draftsError ? "—" : scheduledDrafts}
              </p>
              <p className="text-[11px] text-ink-secondary mt-1">
                {scheduledDrafts === 0
                  ? "No posts currently queued in calendar."
                  : `${scheduledDrafts} queued for automated publication.`}
              </p>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border/60 flex items-center justify-between text-[11px] text-ink-secondary font-medium">
            <span>View calendar</span>
            <ArrowRight size={13} className="text-forest group-hover:translate-x-0.5 transition-transform" />
          </div>
        </Link>

        {/* Metric 3: Published Posts */}
        <Link
          href="/app/performance"
          className="card p-4 hover:border-forest/40 transition-colors flex flex-col justify-between group"
        >
          <div>
            <div className="flex items-center justify-between text-ink-secondary mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Published to Date</span>
              <CheckCircle2 size={16} className="text-forest group-hover:scale-105 transition-transform" />
            </div>
            <div>
              <p className="text-2xl font-bold text-ink">
                {draftsError ? "—" : publishedDrafts}
              </p>
              <p className="text-[11px] text-ink-secondary mt-1">
                Live LinkedIn posts via personal profile.
              </p>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border/60 flex items-center justify-between text-[11px] text-ink-secondary font-medium">
            <span>View performance</span>
            <ArrowRight size={13} className="text-forest group-hover:translate-x-0.5 transition-transform" />
          </div>
        </Link>

        {/* Metric 4: Total Pipeline Posts */}
        <Link
          href="/app/content"
          className="card p-4 hover:border-forest/40 transition-colors flex flex-col justify-between group"
        >
          <div>
            <div className="flex items-center justify-between text-ink-secondary mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Total Pipeline</span>
              <ActivityIcon size={16} className="text-forest group-hover:scale-105 transition-transform" />
            </div>
            <div>
              <p className="text-2xl font-bold text-ink">
                {draftsError ? "—" : totalDrafts}
              </p>
              <p className="text-[11px] text-ink-secondary mt-1">
                Across all draft, review, and live stages.
              </p>
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-border/60 flex items-center justify-between text-[11px] text-ink-secondary font-medium">
            <span>Open content studio</span>
            <ArrowRight size={13} className="text-forest group-hover:translate-x-0.5 transition-transform" />
          </div>
        </Link>
      </div>

      {/* ─── Two-Column Operational Layout ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 cols): Content Operations */}
        <div className="lg:col-span-2 space-y-6">
          {/* Upcoming Scheduled Posts */}
          <div className="card p-5">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-forest" />
                <h2 className="text-sm font-semibold text-ink">Upcoming Scheduled Publications</h2>
              </div>
              <Link href="/app/calendar" className="text-xs font-semibold text-forest hover:text-forest-hover flex items-center gap-1">
                Calendar <ArrowRight size={13} />
              </Link>
            </div>

            {upcomingPosts.length === 0 ? (
              <div className="py-6 text-center text-xs text-ink-secondary">
                <p>No upcoming publications scheduled at this time.</p>
                <p className="text-[11px] mt-1 text-ink-secondary/70">
                  Approve drafts in Content to schedule them onto your publishing calendar.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {upcomingPosts.map((post) => (
                  <div
                    key={post.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg bg-surface border border-border gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-ink truncate">
                        {post.title || "Untitled draft"}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-ink-secondary">
                        <span className="font-medium text-forest">{post.pillar || "General"}</span>
                        <span>&bull;</span>
                        <span>
                          {post.scheduled_for
                            ? new Date(post.scheduled_for).toLocaleDateString(undefined, {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                            : "Scheduled"}
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-forest-light text-forest border border-forest-muted self-start sm:self-auto">
                      Scheduled
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Drafts Needing Review & Attention */}
          <div className="card p-5">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-forest" />
                <h2 className="text-sm font-semibold text-ink">Drafts Awaiting Attention</h2>
              </div>
              <Link href="/app/content" className="text-xs font-semibold text-forest hover:text-forest-hover flex items-center gap-1">
                Review all <ArrowRight size={13} />
              </Link>
            </div>

            {pendingReviewPosts.length === 0 ? (
              <div className="py-6 text-center text-xs text-ink-secondary">
                <CheckCircle2 size={24} className="mx-auto text-forest/50 mb-2" />
                <p>All content drafts are reviewed.</p>
                <p className="text-[11px] mt-1 text-ink-secondary/70">
                  Generate new drafts from your Content Strategy or write a new piece.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {pendingReviewPosts.map((post) => (
                  <div
                    key={post.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg bg-surface border border-border gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-ink truncate">
                        {post.title || "Untitled draft"}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-ink-secondary">
                        <span className="font-medium text-forest">{post.pillar || "General"}</span>
                        <span>&bull;</span>
                        <span>Status: {post.status.replace(/_/g, " ")}</span>
                      </div>
                    </div>
                    <Link
                      href={`/app/content?post=${post.id}`}
                      className="btn-secondary text-[11px] py-1 px-2.5 self-start sm:self-auto whitespace-nowrap"
                    >
                      Review Draft
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column (1 col): Integrations & Automation Health */}
        <div className="space-y-6">
          {/* Integrations Health Panel */}
          <div className="card p-5">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-border">
              <h2 className="text-sm font-semibold text-ink">Channel Health</h2>
              <Link href="/app/integrations" className="text-xs font-semibold text-forest hover:text-forest-hover flex items-center gap-1">
                Manage <ArrowRight size={13} />
              </Link>
            </div>

            <div className="space-y-3 text-xs">
              {/* LinkedIn */}
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-surface border border-border">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Linkedin size={16} className="text-[#0A66C2] shrink-0" />
                  <div className="truncate">
                    <p className="font-semibold text-ink">LinkedIn Profile</p>
                    <p className="text-[11px] text-ink-secondary truncate">
                      {linkedinConnected ? (linkedinProfileName ? `Connected (${linkedinProfileName})` : "Connected") : "Not connected"}
                    </p>
                  </div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${linkedinConnected ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-amber-50 text-amber-800 border border-amber-200"}`}>
                  {linkedinConnected ? "Active" : "Disconnected"}
                </span>
              </div>

              {/* Telegram */}
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-surface border border-border">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Send size={16} className="text-[#229ED9] shrink-0" />
                  <div className="truncate">
                    <p className="font-semibold text-ink">Telegram Bot</p>
                    <p className="text-[11px] text-ink-secondary truncate">
                      {telegramConnected ? "Bot paired & active" : "Pairing token ready"}
                    </p>
                  </div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${telegramConnected ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-surface-alt text-ink-secondary border border-border"}`}>
                  {telegramConnected ? "Linked" : "Unlinked"}
                </span>
              </div>

              {/* MCP */}
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-surface border border-border">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Cpu size={16} className="text-forest shrink-0" />
                  <div className="truncate">
                    <p className="font-semibold text-ink">Remote MCP Server</p>
                    <p className="text-[11px] text-ink-secondary truncate">
                      {mcpActive ? "API endpoint active" : "Key provision ready"}
                    </p>
                  </div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${mcpActive ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-surface-alt text-ink-secondary border border-border"}`}>
                  {mcpActive ? "Active" : "Inactive"}
                </span>
              </div>
            </div>
          </div>

          {/* Automation & Cadence Guardrails */}
          <div className="card p-5">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-border">
              <h2 className="text-sm font-semibold text-ink">Automation Guardrails</h2>
              <Link href="/app/permissions" className="text-xs font-semibold text-forest hover:text-forest-hover flex items-center gap-1">
                Configure <ArrowRight size={13} />
              </Link>
            </div>

            <div className="space-y-2.5 text-xs">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-secondary">Agent State:</span>
                  <span className="font-semibold text-ink flex items-center gap-1.5">
                    <StateIcon size={14} className={stateConfig.color} />
                    {stateConfig.label}
                  </span>
                </div>
                <p className="text-[11px] text-ink-secondary mt-1">
                  {stateConfig.description}
                </p>
              </div>
              <div className="flex items-center justify-between pt-1.5 border-t border-border/50">
                <span className="text-ink-secondary">Operating Mode:</span>
                <span className="font-semibold text-ink">
                  {workspace.operating_mode === "approval_required" ? "Approval Required" : "Autopilot"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-secondary">Daily Publishing Cap:</span>
                <span className="font-semibold text-ink">1 post / day (Hard limit)</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-secondary">Weekly Target Cadence:</span>
                <span className="font-semibold text-ink">
                  {weeklyCadenceTarget} posts / week
                </span>
              </div>
            </div>
          </div>

          {/* Recent Activity Mini-Feed */}
          <div className="card p-5">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-border">
              <h2 className="text-sm font-semibold text-ink">Recent Activity</h2>
              <Link href="/app/activity" className="text-xs font-semibold text-forest hover:text-forest-hover flex items-center gap-1">
                All logs <ArrowRight size={13} />
              </Link>
            </div>

            {activityError ? (
              <p className="text-xs text-error">{activityError}</p>
            ) : recentActivities.length === 0 ? (
              <div className="py-4 text-center text-xs text-ink-secondary">
                <p className="text-2xl font-bold text-ink mb-1">0</p>
                <p>No activity recorded yet.</p>
              </div>
            ) : (
              <div className="space-y-2.5 text-xs">
                {recentActivities.map((item) => (
                  <div key={item.id} className="pb-2 border-b border-border/50 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-ink truncate mr-2">{item.title}</p>
                      {item.statusBadge && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ${item.statusBadge.className}`}>
                          {item.statusBadge.label}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-ink-secondary mt-0.5 truncate">{item.detail}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
