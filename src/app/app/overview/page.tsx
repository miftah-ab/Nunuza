import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, AuthError, ForbiddenError } from "@/lib/auth/workspace";
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
  Target,
  Mic2,
  Lock,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Overview — Nunuza",
  robots: { index: false, follow: false },
};

interface StateDisplay {
  label: string;
  icon: typeof CheckCircle2;
  color: string;
  badgeClass: string;
  description: string;
}

const STATE_CONFIG: Record<AgentState, StateDisplay> = {
  setup_required: {
    label: "Setup required",
    icon: AlertCircle,
    color: "text-amber-600",
    badgeClass: "badge-draft-only",
    description: "Initial setup is incomplete. Complete onboarding to activate your workspace.",
  },
  active_approval_required: {
    label: "Active — review needed",
    icon: CheckCircle2,
    color: "text-forest",
    badgeClass: "badge-active",
    description: "Content drafting is active. All generated posts require your manual review and approval before scheduling or export.",
  },
  active_autopilot: {
    label: "Active — autopilot",
    icon: CheckCircle2,
    color: "text-forest",
    badgeClass: "badge-active",
    description: "Autopilot is active. Posts are scheduled automatically according to your cadence.",
  },
  paused: {
    label: "Paused",
    icon: PauseCircle,
    color: "text-ink-secondary",
    badgeClass: "badge-draft-only",
    description: "Content generation and agent jobs are paused. Resume to continue.",
  },
  blocked_integration: {
    label: "Integration issue",
    icon: WifiOff,
    color: "text-error",
    badgeClass: "badge-error",
    description: "Integration connection issue requires your attention in Integrations.",
  },
  attention_required: {
    label: "Attention required",
    icon: AlertTriangle,
    color: "text-warning",
    badgeClass: "badge-warning",
    description: "Workspace configuration or content pipeline requires review.",
  },
};

const ENTITLEMENT_BADGES: Record<string, { label: string; className: string }> = {
  draft_only: {
    label: "Draft-only preview — no subscription required",
    className: "badge-draft-only",
  },
  publishing_beta: {
    label: "LinkedIn publishing beta — no subscription required",
    className: "badge-beta",
  },
  internal_test: {
    label: "Internal acceptance test",
    className: "badge-error",
  },
  paid_trial: {
    label: "14-day trial",
    className: "badge-active",
  },
  paid_active: {
    label: "Active subscription ($29/mo)",
    className: "badge-active",
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

export default async function OverviewPage() {
  let workspace: Workspace;

  try {
    workspace = await requireWorkspace();
  } catch (err) {
    if (err instanceof AuthError) {
      redirect("/login");
    }
    // If not found or forbidden, send to onboarding
    redirect("/app/onboarding");
  }

  // If setup is still required, redirect to onboarding wizard
  if (workspace.state === "setup_required") {
    redirect("/app/onboarding");
  }

  const supabase = await createClient();

  // ─── 1. Query Draft Counts (isolated strictly by workspace_id) ───────────────
  let draftsAwaitingReview: number | null = null;
  let approvedDrafts: number | null = null;
  let totalDrafts: number | null = null;
  let draftsError: string | null = null;

  try {
    const [awaitingRes, approvedRes, totalRes] = await Promise.all([
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
        .eq("workspace_id", workspace.id),
    ]);

    if (awaitingRes.error) throw new Error(awaitingRes.error.message);
    if (approvedRes.error) throw new Error(approvedRes.error.message);
    if (totalRes.error) throw new Error(totalRes.error.message);

    draftsAwaitingReview = awaitingRes.count ?? 0;
    approvedDrafts = approvedRes.count ?? 0;
    totalDrafts = totalRes.count ?? 0;
  } catch (err: unknown) {
    draftsError = err instanceof Error ? err.message : "Unable to query content drafts.";
  }

  // ─── 2. Query Recent Activity (audit_events & agent_jobs) ────────────────────
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
      .slice(0, 5);
  } catch (err: unknown) {
    activityError = err instanceof Error ? err.message : "Unable to query activity log.";
  }

  // ─── 3. State & Entitlement Badges ───────────────────────────────────────────
  const effectiveState: AgentState = workspace.paused_at ? "paused" : workspace.state;
  const stateConfig = STATE_CONFIG[effectiveState] ?? STATE_CONFIG.setup_required;
  const StateIcon = stateConfig.icon;
  const entitlementBadge = ENTITLEMENT_BADGES[workspace.entitlement_type] ?? {
    label: workspace.entitlement_type,
    className: "badge-draft-only",
  };

  const isDraftOnly = workspace.entitlement_type === "draft_only";

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Overview</h1>
          <p className="text-sm text-ink-secondary mt-0.5">
            {workspace.name}
          </p>
        </div>
        <span className={entitlementBadge.className}>{entitlementBadge.label}</span>
      </div>

      {/* Agent Status Card */}
      <div className="card p-5">
        <div className="flex items-start gap-4">
          <div className="p-2.5 rounded-lg bg-surface border border-border">
            <StateIcon size={22} className={stateConfig.color} aria-hidden="true" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="text-xs text-ink-secondary font-medium uppercase tracking-wider">
                Agent Status
              </p>
              <span className="text-[11px] px-2 py-0.5 rounded font-mono bg-surface-alt text-ink-secondary border border-border">
                {workspace.operating_mode === "approval_required" ? "Approval Required" : "Autopilot"}
              </span>
            </div>
            <p className="text-base font-semibold text-ink mt-0.5">
              {stateConfig.label}
            </p>
            <p className="text-sm text-ink-secondary mt-1">
              {stateConfig.description}
            </p>
          </div>
        </div>
      </div>

      {/* Draft-Only Preview Restrictions Notice */}
      {isDraftOnly && (
        <div className="card border-forest-muted bg-forest-light/40 p-5">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded bg-white/70 border border-forest-muted text-forest">
              <Lock size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">
                Draft-Only Preview Release
              </p>
              <p className="text-sm text-ink-secondary mt-1">
                You can create, review, and export LinkedIn drafts. Automated publishing, background scheduling,
                and Autopilot are locked until official release approval.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* First-Draft Callout when Workspace has 0 Posts */}
      {!draftsError && totalDrafts === 0 && (
        <div className="card border-forest-muted bg-white p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-forest" />
                <h3 className="text-base font-semibold text-ink">Ready for your first draft?</h3>
              </div>
              <p className="text-sm text-ink-secondary mt-1 max-w-xl">
                Your workspace strategy and voice settings are saved. Generate a post with AI using your pillars, or compose your own draft.
              </p>
            </div>
            <Link
              href="/app/content"
              className="btn-primary flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <Sparkles size={16} />
              Create First Draft
            </Link>
          </div>
        </div>
      )}

      {/* Metrics & Activity Grid */}
      <div className="grid sm:grid-cols-2 gap-4">
        {/* Drafts awaiting review */}
        <div className="card p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="section-label">Drafts awaiting review</p>
              <FileText size={16} className="text-ink-secondary" />
            </div>

            {draftsError ? (
              <div className="p-3 rounded bg-error-light/50 border border-error-light text-error text-xs">
                <p className="font-semibold">Query error</p>
                <p className="mt-0.5">{draftsError}</p>
              </div>
            ) : (
              <div>
                <p className="text-3xl font-bold text-ink">
                  {draftsAwaitingReview}
                </p>
                <p className="text-xs text-ink-secondary mt-1.5">
                  {draftsAwaitingReview === 0
                    ? "0 drafts currently waiting for review."
                    : `${draftsAwaitingReview} ${draftsAwaitingReview === 1 ? "draft" : "drafts"} ready for review & approval.`}
                </p>
                {approvedDrafts !== null && approvedDrafts > 0 && (
                  <p className="text-xs text-forest mt-1 font-medium">
                    {approvedDrafts} approved {approvedDrafts === 1 ? "draft" : "drafts"} available to export.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
            <span className="text-xs text-ink-secondary">
              Total drafts: {draftsError ? "—" : totalDrafts}
            </span>
            <Link
              href="/app/content"
              className="text-xs font-semibold text-forest hover:text-forest-hover flex items-center gap-1"
            >
              Go to Content <ArrowRight size={14} />
            </Link>
          </div>
        </div>

        {/* Recent activity */}
        <div className="card p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="section-label">Recent activity</p>
              <ActivityIcon size={16} className="text-ink-secondary" />
            </div>

            {activityError ? (
              <div className="p-3 rounded bg-error-light/50 border border-error-light text-error text-xs">
                <p className="font-semibold">Query error</p>
                <p className="mt-0.5">{activityError}</p>
              </div>
            ) : recentActivities.length === 0 ? (
              <div>
                <p className="text-3xl font-bold text-ink">0</p>
                <p className="text-xs text-ink-secondary mt-1.5">
                  No activity recorded yet. Events will appear as you create, edit, or approve drafts.
                </p>
              </div>
            ) : (
              <div className="space-y-2 mt-2">
                {recentActivities.slice(0, 3).map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0"
                  >
                    <div className="truncate mr-2">
                      <p className="font-medium text-ink truncate">{item.title}</p>
                      <p className="text-[11px] text-ink-secondary truncate">{item.detail}</p>
                    </div>
                    {item.statusBadge && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ${item.statusBadge.className}`}>
                        {item.statusBadge.label}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
            <span className="text-xs text-ink-secondary">
              Logged events: {activityError ? "—" : recentActivities.length}
            </span>
            <Link
              href="/app/activity"
              className="text-xs font-semibold text-forest hover:text-forest-hover flex items-center gap-1"
            >
              View activity log <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </div>

      {/* Quick Navigation Cards */}
      <div className="grid sm:grid-cols-3 gap-3">
        <Link
          href="/app/strategy"
          className="card p-4 hover:border-forest/40 transition-colors flex items-center gap-3 group"
        >
          <div className="p-2 rounded bg-surface border border-border group-hover:border-forest/30">
            <Target size={18} className="text-forest" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">Content Strategy</p>
            <p className="text-xs text-ink-secondary">Pillars, goals, and cadence</p>
          </div>
        </Link>

        <Link
          href="/app/voice"
          className="card p-4 hover:border-forest/40 transition-colors flex items-center gap-3 group"
        >
          <div className="p-2 rounded bg-surface border border-border group-hover:border-forest/30">
            <Mic2 size={18} className="text-forest" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">Voice Profile</p>
            <p className="text-xs text-ink-secondary">Tone, style, and vocabulary</p>
          </div>
        </Link>

        <Link
          href="/app/calendar"
          className="card p-4 hover:border-forest/40 transition-colors flex items-center gap-3 group"
        >
          <div className="p-2 rounded bg-surface border border-border group-hover:border-forest/30">
            <Calendar size={18} className="text-forest" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">Planning Calendar</p>
            <p className="text-xs text-ink-secondary">Cadence and draft schedule</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
