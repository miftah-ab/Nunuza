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
  Calendar,
  Lock,
  Plus,
  Linkedin,
  Send,
  Cpu,
  Clock,
  ShieldCheck,
  TrendingUp,
  Layers,
  Zap,
  Circle,
} from "lucide-react";
import { getTelegramLinkStatus } from "@/lib/integrations/telegram/service";
import { getMcpCredentialStatus } from "@/lib/integrations/mcp/tokens";

// Module-level helper — avoids lint warning about Date.now() inside render
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export const metadata: Metadata = {
  title: "Overview — Nunuza",
  robots: { index: false, follow: false },
};

// ─── State configuration ───────────────────────────────────────────────────────

type StateInfo = {
  label: string;
  icon: typeof CheckCircle2;
  dotClass: string;
  badgeClass: string;
  description: string;
};

const STATE_CONFIG: Record<AgentState, StateInfo> = {
  setup_required: {
    label: "Setup required",
    icon: AlertCircle,
    dotClass: "bg-warning",
    badgeClass: "bg-warning-light text-warning border-warning/20",
    description: "Complete onboarding to activate your workspace.",
  },
  active_approval_required: {
    label: "Active — review required",
    icon: CheckCircle2,
    dotClass: "bg-success",
    badgeClass: "bg-success-light text-success border-success/20",
    description: "Generating drafts. Each post requires your approval before publishing.",
  },
  active_autopilot: {
    label: "Active — autopilot",
    icon: Zap,
    dotClass: "bg-success",
    badgeClass: "bg-success-light text-success border-success/20",
    description: "Autopilot active. Posts are queued automatically within your safety caps.",
  },
  paused: {
    label: "Paused",
    icon: PauseCircle,
    dotClass: "bg-ink-muted",
    badgeClass: "bg-surface text-ink-secondary border-border",
    description: "All background jobs and publishing are halted. Resume to continue.",
  },
  blocked_integration: {
    label: "Integration issue",
    icon: WifiOff,
    dotClass: "bg-error",
    badgeClass: "bg-error-light text-error border-error/20",
    description: "An integration error needs attention before publishing can resume.",
  },
  attention_required: {
    label: "Attention required",
    icon: AlertTriangle,
    dotClass: "bg-warning",
    badgeClass: "bg-warning-light text-warning border-warning/20",
    description: "Workspace configuration or content pipeline needs review.",
  },
};

type EntitlementInfo = { label: string; badgeClass: string };

const ENTITLEMENT_INFO: Record<string, EntitlementInfo> = {
  internal_beta: { label: "Private Beta", badgeClass: "bg-forest-light text-forest border-forest-muted" },
  paid_trial: { label: "Trial Active", badgeClass: "bg-success-light text-success border-success/20" },
  paid_active: { label: "Nunuza Solo", badgeClass: "bg-success-light text-success border-success/20" },
  suspended: { label: "Suspended", badgeClass: "bg-error-light text-error border-error/20" },
  expired: { label: "Trial Expired", badgeClass: "bg-error-light text-error border-error/20" },
  draft_only: { label: "Onboarding", badgeClass: "bg-surface text-ink-secondary border-border" },
  inactive: { label: "Inactive", badgeClass: "bg-surface text-ink-secondary border-border" },
};

interface PostSummary {
  id: string;
  title: string | null;
  pillar: string | null;
  status: string;
  scheduled_for?: string | null;
  updated_at?: string;
  created_at?: string;
}

interface RecentActivityItem {
  id: string;
  source: "audit" | "job";
  title: string;
  detail: string;
  timestamp: string;
  status?: string;
  href?: string;
  external?: boolean;
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default async function OverviewPage() {
  let workspace: Workspace;

  try {
    workspace = await requireWorkspace();
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    redirect("/app/onboarding");
  }

  if (workspace.state === "setup_required") redirect("/app/onboarding");

  const supabase = await createClient();

  // ─── 1. Metrics ──────────────────────────────────────────────────────────────
  let draftsAwaitingReview: number | null = null;
  let approvedDrafts: number | null = null;
  let scheduledDrafts: number | null = null;
  let publishedDrafts: number | null = null;
  let totalDrafts: number | null = null;
  let metricsError = false;

  try {
    const [awaitingRes, approvedRes, scheduledRes, publishedRes, totalRes] = await Promise.all([
      supabase.from("content_posts").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).in("status", ["draft", "needs_review"]),
      supabase.from("content_posts").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("status", "approved"),
      supabase.from("content_posts").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("status", "scheduled"),
      supabase.from("content_posts").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("status", "published"),
      supabase.from("content_posts").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id),
    ]);
    if (!awaitingRes.error && !approvedRes.error) {
      draftsAwaitingReview = awaitingRes.count ?? 0;
      approvedDrafts = approvedRes.count ?? 0;
      scheduledDrafts = scheduledRes.count ?? 0;
      publishedDrafts = publishedRes.count ?? 0;
      totalDrafts = totalRes.count ?? 0;
    } else {
      metricsError = true;
    }
  } catch {
    metricsError = true;
  }

  // ─── 2. Operational posts ────────────────────────────────────────────────────
  let upcomingPosts: PostSummary[] = [];
  let pendingReviewPosts: PostSummary[] = [];

  try {
    const [upcomingRes, pendingRes] = await Promise.all([
      supabase.from("content_posts").select("id, title, pillar, status, scheduled_for, created_at").eq("workspace_id", workspace.id).eq("status", "scheduled").order("scheduled_for", { ascending: true }).limit(4),
      supabase.from("content_posts").select("id, title, pillar, status, updated_at, created_at").eq("workspace_id", workspace.id).in("status", ["draft", "needs_review"]).order("updated_at", { ascending: false }).limit(4),
    ]);
    if (!upcomingRes.error && upcomingRes.data) upcomingPosts = upcomingRes.data as PostSummary[];
    if (!pendingRes.error && pendingRes.data) pendingReviewPosts = pendingRes.data as PostSummary[];
  } catch { /* non-fatal */ }

  // ─── 3. Integration health ───────────────────────────────────────────────────
  let linkedinConnected = false;
  let linkedinProfileName: string | null = null;
  let telegramConnected = false;
  let mcpActive = false;
  let weeklyCadenceTarget = 3;

  try {
    const [linkedinData, telegramStatus, mcpStatus, strategyData] = await Promise.all([
      supabase.from("integration_connections").select("status, metadata").eq("workspace_id", workspace.id).eq("provider", "linkedin").eq("status", "connected").maybeSingle().then(r => r.data),
      getTelegramLinkStatus(workspace.id, supabase).catch(() => ({ linked: false })),
      getMcpCredentialStatus(workspace.id, supabase).catch(() => ({ active: false })),
      supabase.from("content_strategies").select("cadence_per_week").eq("workspace_id", workspace.id).maybeSingle().then(r => r.data),
    ]);
    if (linkedinData) {
      linkedinConnected = true;
      linkedinProfileName = (linkedinData.metadata as any)?.name || null;
    }
    telegramConnected = telegramStatus?.linked ?? false;
    mcpActive = mcpStatus?.active ?? false;
    if (strategyData?.cadence_per_week) weeklyCadenceTarget = strategyData.cadence_per_week;
  } catch { /* non-fatal */ }

  // ─── 4. Recent activity ──────────────────────────────────────────────────────
  let recentActivities: RecentActivityItem[] = [];

  try {
    const [auditRes, jobsRes] = await Promise.all([
      supabase.from("audit_events").select("id, action, actor_type, resource_type, resource_id, safe_metadata, created_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(12),
      supabase.from("agent_jobs").select("id, job_type, status, created_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(3),
    ]);

    const auditItems: RecentActivityItem[] = (auditRes.data ?? []).map((a: any) => {
      const metadata = a.safe_metadata && typeof a.safe_metadata === "object"
        ? a.safe_metadata as Record<string, unknown>
        : {};
      const action = String(a.action ?? "");
      let title = action.replace(/_/g, " ").replace(/^\w/, (c: string) => c.toUpperCase());
      let detail = a.actor_type + (a.resource_type ? ` · ${a.resource_type}` : "");
      let href: string | undefined;
      let external = false;

      if (action === "agent_research_candidate") {
        const candidateTitle = typeof metadata.title === "string" ? metadata.title : "Research opportunity";
        title = `Opportunity: ${candidateTitle}`;
        const reason = metadata.eligible === true
          ? "Matches your strategy"
          : metadata.decisionReason === "strategy_exclusion"
            ? "Excluded by your brand preferences"
            : "Below the relevance threshold";
        const score = typeof metadata.relevanceScore === "number"
          ? `Relevance ${metadata.relevanceScore.toFixed(1)}`
          : null;
        const evidence = typeof metadata.evidence === "string"
          ? metadata.evidence.replace(/\s+/g, " ").slice(0, 150)
          : null;
        detail = [typeof metadata.source === "string" ? metadata.source : null, score, reason, evidence]
          .filter(Boolean).join(" · ");
        const sourceUrl = typeof metadata.articleUrl === "string"
          ? metadata.articleUrl
          : typeof metadata.sourceUrl === "string" ? metadata.sourceUrl : null;
        if (sourceUrl) {
          try {
            const parsed = new URL(sourceUrl);
            if (parsed.protocol === "https:") {
              href = parsed.toString();
              external = true;
            }
          } catch { /* Ignore invalid evidence URLs. */ }
        }
      } else if (action === "agent_cycle_decision") {
        const decision = String(metadata.decision ?? "");
        title = decision === "create_review_draft"
          ? "Draft created for your review"
          : decision === "queue_autopilot_publish"
            ? "Autopilot queued a post"
            : decision === "more_research_required"
              ? "Nunuza needs stronger evidence"
              : decision === "monitor"
                ? "Nunuza is monitoring this opportunity"
                : decision === "reject"
                  ? "Nunuza rejected this opportunity"
                  : "Nunuza decided not to publish";
        detail = typeof metadata.reason === "string" ? metadata.reason : "Decision recorded from the latest research cycle.";
        if (typeof metadata.postId === "string") {
          href = `/app/content?post=${encodeURIComponent(metadata.postId)}`;
        }
      } else if (action === "publish_unconfirmed") {
        title = "LinkedIn publication needs confirmation";
        detail = "Check LinkedIn before confirming. Automatic retry is disabled.";
        if (typeof a.resource_id === "string") {
          href = `/app/content?post=${encodeURIComponent(a.resource_id)}`;
        }
      }

      return {
        id: `audit-${a.id}`,
        source: "audit" as const,
        title,
        detail,
        timestamp: a.created_at,
        href,
        external,
      };
    });

    const jobItems: RecentActivityItem[] = (jobsRes.data ?? []).map((j: any) => ({
      id: `job-${j.id}`,
      source: "job" as const,
      title: (j.job_type as string).replace(/_/g, " ").replace(/^\w/, (c: string) => c.toUpperCase()),
      detail: j.status,
      timestamp: j.created_at,
      status: j.status,
    }));

    recentActivities = [...auditItems, ...jobItems]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 5);
  } catch { /* non-fatal */ }

  // ─── 5. Computed values ──────────────────────────────────────────────────────
  const effectiveState: AgentState = workspace.paused_at ? "paused" : workspace.state;
  const stateInfo = STATE_CONFIG[effectiveState] ?? STATE_CONFIG.setup_required;
  const StateIcon = stateInfo.icon;

  const entitlementInfo = ENTITLEMENT_INFO[workspace.entitlement_type] ?? {
    label: workspace.entitlement_type,
    badgeClass: "bg-surface text-ink-secondary border-border",
  };

  const isBetaOrPaid =
    workspace.entitlement_type === "internal_beta" ||
    workspace.entitlement_type === "paid_trial" ||
    workspace.entitlement_type === "paid_active";

  const needsTrialCTA =
    workspace.entitlement_type === "draft_only" ||
    workspace.entitlement_type === "suspended" ||
    workspace.entitlement_type === "expired";

  const fmt = (iso: string | null | undefined) => iso
    ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  const metrics = [
    {
      href: "/app/content",
      label: "Needs Review",
      value: metricsError ? "—" : (draftsAwaitingReview ?? 0),
      sub: approvedDrafts && approvedDrafts > 0 ? `${approvedDrafts} approved` : null,
      icon: FileText,
      urgent: (draftsAwaitingReview ?? 0) > 0,
    },
    {
      href: "/app/calendar",
      label: "Scheduled",
      value: metricsError ? "—" : (scheduledDrafts ?? 0),
      sub: `target ${weeklyCadenceTarget}/week`,
      icon: Calendar,
      urgent: false,
    },
    {
      href: "/app/performance",
      label: "Published",
      value: metricsError ? "—" : (publishedDrafts ?? 0),
      sub: "to LinkedIn",
      icon: TrendingUp,
      urgent: false,
    },
    {
      href: "/app/content",
      label: "Total Pipeline",
      value: metricsError ? "—" : (totalDrafts ?? 0),
      sub: "all stages",
      icon: Layers,
      urgent: false,
    },
  ];

  const integrations = [
    {
      icon: Linkedin,
      iconClass: "text-[#0A66C2]",
      label: "LinkedIn",
      detail: linkedinConnected
        ? (linkedinProfileName ? linkedinProfileName : "Personal profile connected")
        : "Not connected",
      connected: linkedinConnected,
      href: "/app/integrations",
    },
    {
      icon: Send,
      iconClass: "text-[#229ED9]",
      label: "Telegram",
      detail: telegramConnected ? "Bot paired & active" : "Not paired",
      connected: telegramConnected,
      href: "/app/integrations",
    },
    {
      icon: Cpu,
      iconClass: "text-forest",
      label: "MCP Server",
      detail: mcpActive ? "Endpoint active" : "Inactive",
      connected: mcpActive,
      href: "/app/integrations",
    },
  ];

  return (
    <div className="max-w-6xl mx-auto pb-16 space-y-6 animate-fade-in">

      {/* ─── Page Header ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-ink tracking-tight">Overview</h1>
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${entitlementInfo.badgeClass}`}>
            {entitlementInfo.label}
          </span>
        </div>
        <Link href="/app/content" className="btn-primary self-start sm:self-auto">
          <Plus size={15} />
          New Draft
        </Link>
      </div>

      {/* ─── Trial / Access notice (compact, dismissible-looking) ─── */}
      {needsTrialCTA && (
        <div className="notice-warning flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <Lock size={15} className="shrink-0 mt-0.5 text-warning" />
            <div>
              <p className="text-sm font-semibold text-ink">
                {workspace.entitlement_type === "expired" ? "Trial Expired" : "Start Your Free Trial"}
              </p>
              <p className="text-sm text-ink-secondary mt-0.5">
                Unlock LinkedIn publishing, scheduling, Telegram controls, and Autopilot for $29/month. Card required, cancel anytime.
              </p>
            </div>
          </div>
          <Link href="/app/billing" className="btn-primary shrink-0 self-start sm:self-auto">
            Start Free Trial
          </Link>
        </div>
      )}

      {(workspace.entitlement_type === "internal_beta") && (
        <div className="notice-info flex items-center gap-3">
          <Sparkles size={15} className="shrink-0 text-forest" />
          <p className="text-sm text-ink-secondary">
            <span className="font-semibold text-ink">Private Beta.</span>{" "}
            Full v1.0.0 access — generate, schedule, and publish to LinkedIn. No subscription required.
          </p>
        </div>
      )}

      {workspace.entitlement_type === "paid_trial" && (
        <div className="notice-info flex items-center gap-3">
          <ShieldCheck size={15} className="shrink-0 text-forest" />
          <p className="text-sm text-ink-secondary">
            <span className="font-semibold text-ink">14-Day Trial Active.</span>{" "}
            Full access to all features. Renews at $29/month unless canceled.
          </p>
        </div>
      )}

      {/* ─── Empty state (no posts yet) ─── */}
      {!metricsError && totalDrafts === 0 && (
        <div className="card p-6 flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="w-10 h-10 rounded-xl bg-forest-light flex items-center justify-center shrink-0">
            <Sparkles size={20} className="text-forest" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-ink">Ready for your first draft?</h3>
            <p className="text-sm text-ink-secondary mt-1">
              Your strategy and voice settings are saved. Generate a post with AI using your pillars, or write one manually.
            </p>
          </div>
          <Link href="/app/content" className="btn-primary shrink-0 self-start sm:self-auto">
            <Sparkles size={15} />
            Create First Draft
          </Link>
        </div>
      )}

      {/* ─── KPI Metrics ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {metrics.map(({ href, label, value, sub, icon: Icon, urgent }) => (
          <Link
            key={label}
            href={href}
            className="card p-4 hover:border-forest/30 hover:shadow-card-hover transition-all group flex flex-col gap-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">{label}</span>
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${urgent ? "bg-warning-light" : "bg-forest-light"}`}>
                <Icon size={14} className={urgent ? "text-warning" : "text-forest"} aria-hidden="true" />
              </div>
            </div>
            <div>
              <p className={`text-3xl font-bold leading-none ${urgent && Number(value) > 0 ? "text-warning" : "text-ink"}`}>
                {value}
              </p>
              {sub && (
                <p className="text-xs text-ink-muted mt-1.5">{sub}</p>
              )}
            </div>
            <div className="pt-2 border-t border-border flex items-center justify-between text-xs text-ink-muted font-medium">
              <span>View</span>
              <ArrowRight size={12} className="text-forest group-hover:translate-x-0.5 transition-transform" />
            </div>
          </Link>
        ))}
      </div>

      {/* ─── Main two-column layout ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

        {/* Left — Content pipeline (3 cols) */}
        <div className="lg:col-span-3 space-y-4">

          {/* Upcoming publications */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
              <div className="flex items-center gap-2">
                <Calendar size={15} className="text-forest" />
                <h2 className="text-sm font-semibold text-ink">Upcoming Publications</h2>
              </div>
              <Link href="/app/calendar" className="text-xs font-medium text-forest hover:text-forest-hover flex items-center gap-1 transition-colors">
                Calendar <ArrowRight size={12} />
              </Link>
            </div>

            {upcomingPosts.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <Calendar size={28} className="mx-auto text-border mb-3" />
                <p className="text-sm font-medium text-ink">No scheduled publications</p>
                <p className="text-xs text-ink-muted mt-1">Approve drafts in Content to schedule them.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {upcomingPosts.map((post) => (
                  <div key={post.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-surface/50 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink truncate">
                        {post.title || "Untitled draft"}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {post.pillar && (
                          <span className="text-xs text-forest font-medium">{post.pillar}</span>
                        )}
                        {post.pillar && post.scheduled_for && (
                          <span className="text-ink-muted text-xs">·</span>
                        )}
                        {post.scheduled_for && (
                          <span className="text-xs text-ink-muted flex items-center gap-1">
                            <Clock size={11} />
                            {fmt(post.scheduled_for)}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="badge-draft-only shrink-0 ml-3">Scheduled</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Drafts needing attention */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
              <div className="flex items-center gap-2">
                <FileText size={15} className="text-forest" />
                <h2 className="text-sm font-semibold text-ink">Awaiting Review</h2>
                {(draftsAwaitingReview ?? 0) > 0 && (
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-warning-light text-warning text-xs font-bold">
                    {draftsAwaitingReview}
                  </span>
                )}
              </div>
              <Link href="/app/content" className="text-xs font-medium text-forest hover:text-forest-hover flex items-center gap-1 transition-colors">
                All content <ArrowRight size={12} />
              </Link>
            </div>

            {pendingReviewPosts.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <CheckCircle2 size={28} className="mx-auto text-success/30 mb-3" />
                <p className="text-sm font-medium text-ink">All drafts reviewed</p>
                <p className="text-xs text-ink-muted mt-1">Generate new drafts from your content strategy.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {pendingReviewPosts.map((post) => (
                  <div key={post.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-surface/50 transition-colors gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink truncate">
                        {post.title || "Untitled draft"}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {post.pillar && (
                          <span className="text-xs text-forest font-medium">{post.pillar}</span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${post.status === "needs_review"
                          ? "bg-warning-light text-warning"
                          : "bg-surface text-ink-secondary"
                          }`}>
                          {post.status === "needs_review" ? "Needs review" : "Draft"}
                        </span>
                      </div>
                    </div>
                    <Link
                      href={`/app/content?post=${post.id}`}
                      className="btn-secondary text-xs py-1.5 px-3 shrink-0"
                    >
                      Review
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right — Status & Health (2 cols) */}
        <div className="lg:col-span-2 space-y-4">

          {/* Agent status */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-ink">Agent Status</h2>
              <Link href="/app/permissions" className="text-xs font-medium text-forest hover:text-forest-hover flex items-center gap-1 transition-colors">
                Configure <ArrowRight size={12} />
              </Link>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-xl bg-surface border border-border mb-3">
              <div className={`w-2 h-2 rounded-full shrink-0 ${stateInfo.dotClass}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink">{stateInfo.label}</p>
                <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">{stateInfo.description}</p>
              </div>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-ink-secondary">Operating mode</span>
                <span className="font-medium text-ink">
                  {workspace.operating_mode === "approval_required" ? "Approval required" : "Autopilot"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-secondary">Daily publish cap</span>
                <span className="font-medium text-ink">1 post / day</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-secondary">Weekly target</span>
                <span className="font-medium text-ink">{weeklyCadenceTarget} posts</span>
              </div>
            </div>
          </div>

          {/* Channel health */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-ink">Channel Health</h2>
              <Link href="/app/integrations" className="text-xs font-medium text-forest hover:text-forest-hover flex items-center gap-1 transition-colors">
                Manage <ArrowRight size={12} />
              </Link>
            </div>

            <div className="space-y-2">
              {integrations.map(({ icon: Icon, iconClass, label, detail, connected, href }) => (
                <Link
                  key={label}
                  href={href}
                  className="flex items-center justify-between p-3 rounded-xl bg-surface border border-border hover:border-forest/20 hover:bg-forest-light/20 transition-colors group"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon size={16} className={`${iconClass} shrink-0`} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{label}</p>
                      <p className="text-xs text-ink-muted truncate mt-0.5">{detail}</p>
                    </div>
                  </div>
                  <div className={`flex items-center gap-1.5 shrink-0 ml-2 text-xs font-medium px-2 py-0.5 rounded-full border ${connected
                    ? "bg-success-light text-success border-success/20"
                    : "bg-surface text-ink-muted border-border"
                    }`}>
                    <Circle size={6} className={connected ? "text-success fill-success" : "text-ink-muted fill-ink-muted"} />
                    {connected ? "Connected" : "Disconnected"}
                  </div>
                </Link>
              ))}
            </div>

            {!linkedinConnected && isBetaOrPaid && (
              <div className="mt-3 p-3 rounded-xl bg-warning-light border border-warning/20">
                <p className="text-xs font-medium text-warning flex items-center gap-1.5">
                  <AlertTriangle size={12} />
                  Connect LinkedIn to enable publishing
                </p>
              </div>
            )}
          </div>

          {/* Recent activity */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-ink">Recent Activity</h2>
              <Link href="/app/activity" className="text-xs font-medium text-forest hover:text-forest-hover flex items-center gap-1 transition-colors">
                All logs <ArrowRight size={12} />
              </Link>
            </div>

            {recentActivities.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm text-ink-muted">No activity recorded yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentActivities.map((item) => (
                  <div key={item.id} className="flex items-start gap-3">
                    <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${item.status === "succeeded" ? "bg-success" :
                      item.status?.startsWith("failed") ? "bg-error" :
                        item.source === "job" ? "bg-warning" : "bg-forest"
                      }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-ink truncate" title={item.title}>{item.title}</p>
                      {item.detail && <p className="text-xs text-ink-muted mt-0.5 line-clamp-2">{item.detail}</p>}
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-[11px] text-ink-muted">{relativeTime(item.timestamp)}</p>
                        {item.href && (item.external ? (
                          <a href={item.href} target="_blank" rel="noopener noreferrer" className="text-[11px] font-medium text-forest hover:underline">Evidence</a>
                        ) : (
                          <Link href={item.href} className="text-[11px] font-medium text-forest hover:underline">Open</Link>
                        ))}
                      </div>
                    </div>
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
