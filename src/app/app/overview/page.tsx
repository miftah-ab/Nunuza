import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, AuthError } from "@/lib/auth/workspace";
import type { Workspace, AgentState } from "@/types/database";
import {
  AlertCircle, AlertTriangle, ArrowRight, Calendar, CheckCircle2, Circle,
  Clock, Cpu, FileText, Layers, Linkedin, Lock, PauseCircle, Plus, Send,
  Sparkles, TrendingUp, WifiOff, Zap,
} from "lucide-react";
import { getTelegramLinkStatus } from "@/lib/integrations/telegram/service";
import { getMcpCredentialStatus } from "@/lib/integrations/mcp/tokens";

export const metadata: Metadata = {
  title: "Overview — Nunuza",
  robots: { index: false, follow: false },
};

type StateInfo = {
  label: string;
  icon: typeof CheckCircle2;
  dotClass: string;
  badgeClass: string;
  description: string;
};

const STATE_CONFIG: Record<AgentState, StateInfo> = {
  setup_required: { label: "Setup required", icon: AlertCircle, dotClass: "bg-warning", badgeClass: "bg-warning-light text-warning border-warning/20", description: "Complete workspace setup before activating the agent." },
  active_approval_required: { label: "Approval required", icon: CheckCircle2, dotClass: "bg-success", badgeClass: "bg-success-light text-success border-success/20", description: "The agent can prepare drafts. Your approval is required before publishing." },
  active_autopilot: { label: "Autopilot enabled", icon: Zap, dotClass: "bg-success", badgeClass: "bg-success-light text-success border-success/20", description: "Nunuza is running automatically within the safety settings you’ve chosen." },
  paused: { label: "Paused", icon: PauseCircle, dotClass: "bg-ink-muted", badgeClass: "bg-surface text-ink-secondary border-border", description: "The workspace is paused. Background work should not proceed." },
  blocked_integration: { label: "Integration blocked", icon: WifiOff, dotClass: "bg-error", badgeClass: "bg-error-light text-error border-error/20", description: "Nunuza can’t continue until a connected account is fixed." },
  attention_required: { label: "Attention required", icon: AlertTriangle, dotClass: "bg-warning", badgeClass: "bg-warning-light text-warning border-warning/20", description: "Workspace configuration or the content pipeline needs attention." },
};

const ENTITLEMENT_INFO: Record<string, { label: string; badgeClass: string }> = {
  internal_beta: { label: "Private Beta", badgeClass: "bg-forest-light text-forest border-forest-muted" },
  paid_trial: { label: "Trial Active", badgeClass: "bg-success-light text-success border-success/20" },
  paid_active: { label: "Nunuza Solo", badgeClass: "bg-success-light text-success border-success/20" },
  suspended: { label: "Suspended", badgeClass: "bg-error-light text-error border-error/20" },
  expired: { label: "Trial Expired", badgeClass: "bg-error-light text-error border-error/20" },
  draft_only: { label: "Onboarding", badgeClass: "bg-surface text-ink-secondary border-border" },
  inactive: { label: "Inactive", badgeClass: "bg-surface text-ink-secondary border-border" },
};

type PostSummary = {
  id: string;
  internal_title: string | null;
  pillar: string | null;
  status: string;
  scheduled_at?: string | null;
  updated_at?: string;
};

type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  timestamp: string;
  status?: string;
  source: "audit" | "job";
};

function relativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  const mins = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

function formatDate(iso: string | null | undefined, timezone?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function isLinkedInConnectionExpired(status: string | null | undefined, expiresAt: string | null | undefined): boolean {
  if (status === "expired") return true;
  if (!expiresAt) return false;
  const expiry = new Date(expiresAt).getTime();
  return !Number.isFinite(expiry) || expiry <= Date.now();
}

function workerJobLabel(job: { status: string; lease_until: string | null } | null): { label: string; detail: string; tone: string } {
  if (!job) return { label: "No recent tasks", detail: "Your recent Nunuza activity will appear here.", tone: "text-ink-muted" };
  if (job.status === "running" && (!job.lease_until || !Number.isFinite(new Date(job.lease_until).getTime()) || new Date(job.lease_until).getTime() < Date.now())) {
    return { label: "A task needs attention", detail: "A task is taking longer than expected. Check Activity for the latest update.", tone: "text-error" };
  }
  const labels: Record<string, { label: string; detail: string; tone: string }> = {
    running: { label: "In progress", detail: "Nunuza is working on a task.", tone: "text-success" },
    queued: { label: "Waiting to start", detail: "Your task is in line and will start shortly.", tone: "text-warning" },
    waiting_for_approval: { label: "Waiting for approval", detail: "The job is paused for a user decision.", tone: "text-warning" },
    succeeded: { label: "Completed", detail: "Your latest task finished successfully.", tone: "text-success" },
    failed_retryable: { label: "Trying again", detail: "Something interrupted the last task. Nunuza will try again when possible.", tone: "text-warning" },
    failed_terminal: { label: "Couldn’t complete", detail: "Nunuza couldn’t finish the last task. Review Activity or contact support.", tone: "text-error" },
    needs_reconciliation: { label: "Confirm publishing status", detail: "Check your LinkedIn profile before trying to publish again.", tone: "text-error" },
    canceled: { label: "Last job canceled", detail: "The latest recorded job was canceled.", tone: "text-ink-muted" },
  };
  return labels[job.status] ?? { label: humanize(job.status), detail: "Latest task status.", tone: "text-ink-muted" };
}

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
  const pipelineStatuses = ["draft", "needs_review", "approved", "scheduled", "publishing", "needs_reconciliation"];

  const [
    awaitingRes, approvedRes, scheduledRes, publishedRes, pipelineRes,
    upcomingRes, pendingRes, linkedinRes, strategyRes, latestJobRes,
    auditRes, jobsRes, telegramStatus, mcpStatus,
  ] = await Promise.all([
    supabase.from("content_posts").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).in("status", ["draft", "needs_review"]),
    supabase.from("content_posts").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("status", "approved"),
    supabase.from("content_posts").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("status", "scheduled"),
    supabase.from("content_posts").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("status", "published"),
    supabase.from("content_posts").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).in("status", pipelineStatuses),
    supabase.from("content_posts").select("id, internal_title, pillar, status, scheduled_at").eq("workspace_id", workspace.id).eq("status", "scheduled").not("scheduled_at", "is", null).order("scheduled_at", { ascending: true }).limit(4),
    supabase.from("content_posts").select("id, internal_title, pillar, status, updated_at").eq("workspace_id", workspace.id).in("status", ["draft", "needs_review"]).order("updated_at", { ascending: false }).limit(4),
    supabase.from("integration_connections").select("status, expires_at, metadata").eq("workspace_id", workspace.id).eq("provider", "linkedin").maybeSingle(),
    supabase.from("content_strategies").select("cadence_per_week, timezone").eq("workspace_id", workspace.id).maybeSingle(),
    supabase.from("agent_jobs").select("id, job_type, status, started_at, finished_at, lease_until, created_at, updated_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("audit_events").select("id, action, actor_type, resource_type, created_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(4),
    supabase.from("agent_jobs").select("id, job_type, status, started_at, finished_at, lease_until, created_at, updated_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(4),
    getTelegramLinkStatus(workspace.id, supabase).catch(() => null),
    getMcpCredentialStatus(workspace.id, supabase).catch(() => null),
  ]);

  const metricErrors = [awaitingRes, approvedRes, scheduledRes, publishedRes, pipelineRes].some((r) => r.error);
  const integrationError = Boolean(linkedinRes.error || strategyRes.error || telegramStatus === null || mcpStatus === null);
  const activityError = Boolean(auditRes.error || jobsRes.error);
  const workerJobError = Boolean(latestJobRes.error);

  const counts = {
    awaiting: awaitingRes.count ?? 0,
    approved: approvedRes.count ?? 0,
    scheduled: scheduledRes.count ?? 0,
    published: publishedRes.count ?? 0,
    pipeline: pipelineRes.count ?? 0,
  };

  const upcomingPosts = (upcomingRes.data ?? []) as PostSummary[];
  const pendingPosts = (pendingRes.data ?? []) as PostSummary[];
  const strategy = strategyRes.data;
  const timezone = strategy?.timezone ?? undefined;
  const weeklyTarget = strategy?.cadence_per_week ?? null;

  const linkedin = linkedinRes.data;
  const linkedinExpired = isLinkedInConnectionExpired(linkedin?.status, linkedin?.expires_at);
  const linkedinConnected = linkedin?.status === "connected" && !linkedinExpired;
  const linkedinProfileName = (linkedin?.metadata as Record<string, unknown> | null)?.name;
  const latestJob = latestJobRes.data;
  const workerStatus = workerJobLabel(latestJob);
  const effectiveState: AgentState = workspace.paused_at ? "paused" : workspace.state;
  const stateInfo = STATE_CONFIG[effectiveState] ?? STATE_CONFIG.attention_required;
  const StateIcon = stateInfo.icon;
  const entitlementInfo = ENTITLEMENT_INFO[workspace.entitlement_type] ?? {
    label: humanize(workspace.entitlement_type),
    badgeClass: "bg-surface text-ink-secondary border-border",
  };
  const paidOrBeta = ["internal_beta", "paid_trial", "paid_active"].includes(workspace.entitlement_type);
  const needsBilling = ["draft_only", "suspended", "expired"].includes(workspace.entitlement_type);

  const auditItems: ActivityItem[] = (auditRes.data ?? []).map((event) => ({
    id: `audit-${event.id}`,
    title: humanize(event.action),
    detail: `${humanize(event.actor_type)}${event.resource_type ? ` · ${humanize(event.resource_type)}` : ""}`,
    timestamp: event.created_at,
    source: "audit",
  }));
  const jobItems: ActivityItem[] = (jobsRes.data ?? []).map((job) => ({
    id: `job-${job.id}`,
    title: humanize(job.job_type),
    detail: humanize(job.status),
    timestamp: job.finished_at ?? job.started_at ?? job.updated_at ?? job.created_at,
    status: job.status,
    source: "job",
  }));
  const activities = [...auditItems, ...jobItems]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5);

  const metrics = [
    { href: "/app/content", label: "Needs Review", value: counts.awaiting, sub: counts.approved ? `${counts.approved} approved` : "Drafts awaiting action", icon: FileText },
    { href: "/app/calendar", label: "Scheduled", value: counts.scheduled, sub: weeklyTarget === null ? "Strategy target not set" : `${weeklyTarget} per week target`, icon: Calendar },
    { href: "/app/performance", label: "Published", value: counts.published, sub: "Published posts", icon: TrendingUp },
    { href: "/app/content", label: "Active Pipeline", value: counts.pipeline, sub: "Excludes canceled and terminal posts", icon: Layers },
  ];

  const integrations = [
    { icon: Linkedin, iconClass: "text-[#0A66C2]", label: "LinkedIn", detail: integrationError ? "Status unavailable" : linkedinExpired ? "Connection expired" : linkedinConnected ? (typeof linkedinProfileName === "string" ? linkedinProfileName : "Personal profile connected") : "Not connected", connected: linkedinConnected, warning: linkedinExpired || Boolean(linkedinRes.error) },
    { icon: Send, iconClass: "text-[#229ED9]", label: "Telegram", detail: telegramStatus === null ? "Status unavailable" : telegramStatus?.linked ? "Bot paired" : "Not paired", connected: telegramStatus?.linked ?? false, warning: telegramStatus === null },
    { icon: Cpu, iconClass: "text-forest", label: "AI tools", detail: mcpStatus === null ? "Status unavailable" : mcpStatus?.active ? "Connected" : "Not connected", connected: mcpStatus?.active ?? false, warning: mcpStatus === null },
  ];

  return (
    <div className="max-w-6xl mx-auto pb-16 space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-ink tracking-tight">Overview</h1>
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${entitlementInfo.badgeClass}`}>{entitlementInfo.label}</span>
        </div>
        <Link href="/app/content" className="btn-primary self-start sm:self-auto"><Plus size={15} />New Draft</Link>
      </div>

      {needsBilling && (
        <div className="notice-warning flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3">
            <Lock size={15} className="shrink-0 mt-0.5 text-warning" />
            <div>
              <p className="text-sm font-semibold text-ink">{workspace.entitlement_type === "expired" ? "Trial expired" : "Publishing access is restricted"}</p>
              <p className="text-sm text-ink-secondary mt-0.5">Review your workspace access and available plan options.</p>
            </div>
          </div>
          <Link href="/app/billing" className="btn-primary shrink-0 self-start sm:self-auto">View Billing</Link>
        </div>
      )}

      {workspace.entitlement_type === "internal_beta" && (
        <div className="notice-info flex items-center gap-3"><Sparkles size={15} className="shrink-0 text-forest" /><p className="text-sm text-ink-secondary"><span className="font-semibold text-ink">Private Beta.</span> Your workspace has private-beta access.</p></div>
      )}

      {metricErrors && <div role="alert" className="notice-warning text-sm">Some numbers are temporarily unavailable. Open the relevant page to refresh them before making decisions.</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {metrics.map(({ href, label, value, sub, icon: Icon }) => (
          <Link key={label} href={href} className="card p-4 hover:border-forest/30 hover:shadow-card-hover transition-all group flex flex-col gap-3">
            <div className="flex items-center justify-between"><span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">{label}</span><div className="w-7 h-7 rounded-lg bg-forest-light flex items-center justify-center"><Icon size={14} className="text-forest" aria-hidden="true" /></div></div>
            <div><p className="text-3xl font-bold leading-none text-ink">{metricErrors ? "—" : value}</p><p className="text-xs text-ink-muted mt-1.5">{sub}</p></div>
            <div className="pt-2 border-t border-border flex items-center justify-between text-xs text-ink-muted font-medium"><span>View</span><ArrowRight size={12} className="text-forest group-hover:translate-x-0.5 transition-transform" /></div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3 space-y-4">
          <section className="card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border"><div className="flex items-center gap-2"><Calendar size={15} className="text-forest" /><h2 className="text-sm font-semibold text-ink">Upcoming Publications</h2></div><Link href="/app/calendar" className="text-xs font-medium text-forest flex items-center gap-1">Calendar <ArrowRight size={12} /></Link></div>
            {upcomingRes.error ? <p role="alert" className="px-5 py-6 text-sm text-warning">Upcoming publications could not be loaded. Open Calendar to retry.</p> : upcomingPosts.length === 0 ? <div className="px-5 py-9 text-center"><Calendar size={26} className="mx-auto text-border mb-3" /><p className="text-sm font-medium text-ink">No upcoming publications</p><p className="text-xs text-ink-muted mt-1">Scheduled posts will appear here.</p></div> : (
              <div className="divide-y divide-border">{upcomingPosts.map((post) => <div key={post.id} className="flex items-center justify-between px-5 py-3.5 gap-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-ink truncate">{post.internal_title || "Untitled post"}</p><div className="flex items-center gap-2 mt-0.5">{post.pillar && <span className="text-xs text-forest font-medium">{post.pillar}</span>}<span className="text-xs text-ink-muted flex items-center gap-1"><Clock size={11} />{formatDate(post.scheduled_at, timezone) ?? "Time unavailable"}</span></div></div><span className="badge-draft-only shrink-0">Scheduled</span></div>)}</div>
            )}
          </section>

          <section className="card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border"><div className="flex items-center gap-2"><FileText size={15} className="text-forest" /><h2 className="text-sm font-semibold text-ink">Drafts Needing Attention</h2>{!metricErrors && counts.awaiting > 0 && <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-warning-light text-warning text-xs font-bold">{counts.awaiting}</span>}</div><Link href="/app/content" className="text-xs font-medium text-forest flex items-center gap-1">All content <ArrowRight size={12} /></Link></div>
            {pendingRes.error ? <p role="alert" className="px-5 py-6 text-sm text-warning">Drafts could not be loaded. Open Content to retry.</p> : pendingPosts.length === 0 ? <div className="px-5 py-9 text-center"><CheckCircle2 size={26} className="mx-auto text-success/30 mb-3" /><p className="text-sm font-medium text-ink">No drafts awaiting review</p><p className="text-xs text-ink-muted mt-1">New drafts will appear here when they need your attention.</p></div> : (
              <div className="divide-y divide-border">{pendingPosts.map((post) => <div key={post.id} className="flex items-center justify-between px-5 py-3.5 gap-4"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-ink truncate">{post.internal_title || "Untitled post"}</p><div className="flex items-center gap-2 mt-0.5">{post.pillar && <span className="text-xs text-forest font-medium">{post.pillar}</span>}<span className={`text-xs px-2 py-0.5 rounded-full font-medium ${post.status === "needs_review" ? "bg-warning-light text-warning" : "bg-surface text-ink-secondary"}`}>{post.status === "needs_review" ? "Needs review" : "Draft"}</span></div></div><Link href={`/app/content?post=${post.id}`} className="btn-secondary text-xs py-1.5 px-3 shrink-0">Review</Link></div>)}</div>
            )}
          </section>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <section className="card p-5">
            <div className="flex items-center justify-between mb-4"><h2 className="text-sm font-semibold text-ink">Nunuza status</h2><Link href="/app/permissions" className="text-xs font-medium text-forest flex items-center gap-1">Configure <ArrowRight size={12} /></Link></div>
            <div className="flex items-start gap-3 p-3 rounded-xl bg-surface border border-border mb-3"><div className={`w-2 h-2 rounded-full shrink-0 mt-1 ${stateInfo.dotClass}`} /><div className="flex-1 min-w-0"><p className="text-sm font-semibold text-ink">{stateInfo.label}</p><p className="text-xs text-ink-muted mt-0.5 leading-relaxed">{stateInfo.description}</p></div></div>
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between"><span className="text-ink-secondary">Operating mode</span><span className="font-medium text-ink">{workspace.operating_mode === "approval_required" ? "Approval required" : "Autopilot"}</span></div>
              <div className="flex items-center justify-between"><span className="text-ink-secondary">Weekly strategy target</span><span className="font-medium text-ink">{weeklyTarget === null ? "Not set yet" : `${weeklyTarget} posts`}</span></div>
              <div className="border-t border-border pt-3"><div className="flex items-center justify-between gap-2"><span className="text-ink-secondary">Latest task</span><span className={`font-semibold text-right ${workerStatus.tone}`}>{workerJobError ? "Status unavailable" : workerStatus.label}</span></div><p className="text-xs text-ink-muted mt-1">{workerJobError ? "Recent task status is temporarily unavailable." : workerStatus.detail}</p>{latestJob?.created_at && <p className="text-xs text-ink-muted mt-1">Created {formatDate(latestJob.created_at, timezone)}</p>}</div>
              <p className="text-xs text-ink-muted border-t border-border pt-3">Publishing limits depend on your current plan and account activity. Nunuza will let you know if you reach a limit.</p>
            </div>
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between mb-4"><h2 className="text-sm font-semibold text-ink">Channel Health</h2><Link href="/app/integrations" className="text-xs font-medium text-forest flex items-center gap-1">Manage <ArrowRight size={12} /></Link></div>
            <div className="space-y-2">{integrations.map(({ icon: Icon, iconClass, label, detail, connected, warning }) => <Link key={label} href="/app/integrations" className="flex items-center justify-between p-3 rounded-xl bg-surface border border-border hover:border-forest/20 transition-colors gap-2"><div className="flex items-center gap-2.5 min-w-0"><Icon size={16} className={`${iconClass} shrink-0`} /><div className="min-w-0"><p className="text-sm font-medium text-ink">{label}</p><p className="text-xs text-ink-muted truncate mt-0.5">{detail}</p></div></div><span className={`flex items-center gap-1.5 shrink-0 text-xs font-medium px-2 py-0.5 rounded-full border ${warning ? "bg-warning-light text-warning border-warning/20" : connected ? "bg-success-light text-success border-success/20" : "bg-surface text-ink-muted border-border"}`}><Circle size={6} className={connected && !warning ? "text-success fill-success" : "text-ink-muted fill-ink-muted"} />{warning ? "Attention" : connected ? "Connected" : "Disconnected"}</span></Link>)}</div>
            {integrationError && <p role="alert" className="mt-3 text-xs text-warning">LinkedIn or strategy status could not be verified. Open Integrations to check.</p>}
            {!linkedinConnected && paidOrBeta && <div className="mt-3 p-3 rounded-xl bg-warning-light border border-warning/20"><p className="text-xs font-medium text-warning flex items-center gap-1.5"><AlertTriangle size={12} />{linkedinExpired ? "Reconnect LinkedIn to resume publishing" : "Connect LinkedIn to enable publishing"}</p></div>}
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between mb-4"><h2 className="text-sm font-semibold text-ink">Recent Activity</h2><Link href="/app/activity" className="text-xs font-medium text-forest flex items-center gap-1">All activity <ArrowRight size={12} /></Link></div>
            {activityError ? <p role="alert" className="text-sm text-warning">Activity history could not be loaded.</p> : activities.length === 0 ? <p className="text-sm text-ink-muted text-center py-5">No activity recorded yet.</p> : <div className="space-y-3">{activities.map((item) => <div key={item.id} className="flex items-start gap-3"><div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${item.status === "succeeded" ? "bg-success" : item.status?.startsWith("failed") || item.status === "needs_reconciliation" ? "bg-error" : item.source === "job" ? "bg-warning" : "bg-forest"}`} /><div className="flex-1 min-w-0"><p className="text-xs font-medium text-ink capitalize truncate">{item.title}</p><p className="text-xs text-ink-muted mt-0.5">{item.detail} · {relativeTime(item.timestamp)}</p></div></div>)}</div>}
          </section>
        </div>
      </div>
    </div>
  );
}
