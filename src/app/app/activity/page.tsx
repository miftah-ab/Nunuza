import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock3,
  FileText,
  RefreshCw,
  ShieldCheck,
  UserRound,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, AuthError } from "@/lib/auth/workspace";

export const metadata: Metadata = {
  title: "Activity — Nunuza",
  robots: { index: false, follow: false },
};

type ActivityFilter = "all" | "agent" | "content" | "approvals" | "system";
type ActivityItem = {
  id: string;
  category: Exclude<ActivityFilter, "all">;
  title: string;
  description?: string;
  actor: string;
  timestamp: string;
  status?: string;
  icon: LucideIcon;
};

const FILTERS: { value: ActivityFilter; label: string }[] = [
  { value: "all", label: "All activity" },
  { value: "agent", label: "Agent" },
  { value: "content", label: "Content" },
  { value: "approvals", label: "Approvals" },
  { value: "system", label: "System" },
];

const PAGE_SIZE = 25;

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function actorLabel(value: string | null | undefined): string {
  switch (value) {
    case "user": return "You";
    case "telegram": return "Telegram";
    case "mcp": return "Connected tool";
    case "admin": return "Nunuza support";
    case "system": return "Nunuza";
    default: return "Nunuza";
  }
}

function statusLabel(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const labels: Record<string, string> = {
    queued: "Queued",
    running: "In progress",
    waiting_for_approval: "Awaiting approval",
    succeeded: "Completed",
    failed_retryable: "Retrying",
    failed_terminal: "Failed",
    canceled: "Canceled",
    needs_reconciliation: "Needs attention",
    approved: "Approved",
    rejected: "Rejected",
    revised: "Revised",
    auto_approved: "Auto-approved",
  };
  return labels[value] ?? humanize(value);
}

function statusTone(value?: string): string {
  if (value === "succeeded" || value === "approved" || value === "auto_approved") {
    return "bg-success-light text-success";
  }
  if (value === "failed_terminal" || value === "rejected" || value === "needs_reconciliation") {
    return "bg-error-light text-error";
  }
  if (value === "running" || value === "queued" || value === "waiting_for_approval" || value === "failed_retryable") {
    return "bg-forest-light text-forest";
  }
  return "bg-surface text-ink-secondary";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return date.toLocaleString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function describeAudit(action: string, resourceType: string): {
  title: string;
  category: Exclude<ActivityFilter, "all">;
  icon: LucideIcon;
} {
  const normalized = action.toLowerCase();
  if (/approv|reject|review/.test(normalized)) {
    return { title: humanize(action), category: "approvals", icon: ShieldCheck };
  }
  if (/post|content|draft|publish|schedule/.test(normalized) || resourceType === "content_post") {
    return { title: humanize(action), category: "content", icon: FileText };
  }
  if (/agent|cycle|research|opportunity|decision|plan/.test(normalized)) {
    return { title: humanize(action), category: "agent", icon: Bot };
  }
  return { title: humanize(action), category: "system", icon: Activity };
}

function dayKey(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toISOString().slice(0, 10);
}

function dayLabel(key: string): string {
  if (key === "unknown") return "Date unavailable";
  const date = new Date(`${key}T00:00:00.000Z`);
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; page?: string }>;
}) {
  let workspace;
  try {
    workspace = await requireWorkspace();
  } catch (error) {
    if (error instanceof AuthError) redirect("/login");
    redirect("/app/onboarding");
  }

  const params = await searchParams;
  const requestedFilter = params.type as ActivityFilter;
  const activeFilter: ActivityFilter = FILTERS.some((filter) => filter.value === requestedFilter)
    ? requestedFilter
    : "all";
  const parsedPage = Number.parseInt(params.page ?? "1", 10);
  const currentPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  const supabase = await createClient();
  const [auditResult, approvalResult, jobsResult, attemptsResult] = await Promise.all([
    supabase
      .from("audit_events")
      .select("id, actor_type, action, resource_type, created_at")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("approval_events")
      .select("id, actor_type, action, created_at")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("agent_jobs")
      .select("id, job_type, status, created_at, started_at, finished_at, safe_error_message")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("agent_job_attempts")
      .select("id, job_id, attempt_number, started_at, finished_at, outcome, safe_error_code")
      .eq("workspace_id", workspace.id)
      .order("started_at", { ascending: false })
      .limit(100),
  ]);

  const failedQuery = auditResult.error || approvalResult.error || jobsResult.error || attemptsResult.error;
  if (failedQuery) {
    console.error("[activity] Failed to load workspace activity", failedQuery);
  }

  const items: ActivityItem[] = [];

  for (const event of auditResult.data ?? []) {
    const description = describeAudit(event.action, event.resource_type);
    items.push({
      id: `audit-${event.id}`,
      category: description.category,
      title: description.title,
      description: event.resource_type ? `Related to ${humanize(event.resource_type)}` : undefined,
      actor: actorLabel(event.actor_type),
      timestamp: event.created_at,
      icon: description.icon,
    });
  }

  for (const event of approvalResult.data ?? []) {
    items.push({
      id: `approval-${event.id}`,
      category: "approvals",
      title: event.action === "approved"
        ? "Post approved"
        : event.action === "rejected"
          ? "Post rejected"
          : event.action === "revised"
            ? "Post sent for revision"
            : "Post approved automatically",
      actor: actorLabel(event.actor_type),
      timestamp: event.created_at,
      status: event.action,
      icon: ShieldCheck,
    });
  }

  for (const job of jobsResult.data ?? []) {
    const timestamp = job.finished_at ?? job.started_at ?? job.created_at;
    const isAttention = job.status === "failed_terminal" || job.status === "needs_reconciliation";
    items.push({
      id: `job-${job.id}`,
      category: "agent",
      title: `${humanize(job.job_type)} ${job.status === "succeeded" ? "completed" : job.status === "failed_terminal" ? "failed" : "job"}`,
      description: job.safe_error_message?.slice(0, 180) ?? undefined,
      actor: "Nunuza",
      timestamp,
      status: job.status,
      icon: isAttention ? AlertCircle : Bot,
    });
  }

  for (const attempt of attemptsResult.data ?? []) {
    const timestamp = attempt.finished_at ?? attempt.started_at;
    if (!timestamp) continue;
    items.push({
      id: `attempt-${attempt.id}`,
      category: "system",
      title: `Job attempt ${attempt.attempt_number} ${attempt.finished_at ? "finished" : "started"}`,
      description: attempt.safe_error_code ? `Reference: ${attempt.safe_error_code}` : undefined,
      actor: "Nunuza",
      timestamp,
      status: attempt.outcome ?? (attempt.finished_at ? undefined : "running"),
      icon: RefreshCw,
    });
  }

  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const filteredItems = activeFilter === "all"
    ? items
    : items.filter((item) => item.category === activeFilter);
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pageItems = filteredItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const groupedItems = pageItems.reduce<Record<string, ActivityItem[]>>((groups, item) => {
    const key = dayKey(item.timestamp);
    (groups[key] ??= []).push(item);
    return groups;
  }, {});

  function filterHref(filter: ActivityFilter): string {
    return filter === "all" ? "/app/activity" : `/app/activity?type=${filter}`;
  }

  function pageHref(page: number): string {
    const query = new URLSearchParams();
    if (activeFilter !== "all") query.set("type", activeFilter);
    query.set("page", String(page));
    return `/app/activity?${query.toString()}`;
  }

  return (
    <div className="max-w-4xl mx-auto animate-fade-in pb-12">
      <header className="mb-7">
        <div className="flex items-center gap-2 text-ink-secondary mb-2">
          <Activity size={17} aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wider">Workspace history</span>
        </div>
        <h1 className="text-2xl font-bold text-ink">Activity</h1>
        <p className="text-sm text-ink-secondary mt-1">
          A chronological record of what you and Nunuza have done in {workspace.name}.
        </p>
      </header>

      <nav aria-label="Filter activity" className="flex flex-wrap gap-2 mb-6">
        {FILTERS.map((filter) => {
          const selected = activeFilter === filter.value;
          return (
            <Link
              key={filter.value}
              href={filterHref(filter.value)}
              aria-current={selected ? "page" : undefined}
              className={selected
                ? "px-3 py-1.5 rounded-full text-xs font-semibold bg-forest text-white"
                : "px-3 py-1.5 rounded-full text-xs font-medium border border-border text-ink-secondary hover:bg-surface"}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>

      {failedQuery ? (
        <section className="card p-7" role="alert">
          <div className="flex items-center gap-2 text-error font-semibold text-sm">
            <AlertCircle size={18} aria-hidden="true" />
            Activity couldn't be loaded
          </div>
          <p className="text-sm text-ink-secondary mt-2">
            We couldn't retrieve your workspace history. Please refresh the page. Your content and scheduled work are unaffected.
          </p>
        </section>
      ) : filteredItems.length === 0 ? (
        <section className="card p-10 text-center">
          <Activity size={30} className="mx-auto text-ink-muted mb-3" aria-hidden="true" />
          <h2 className="text-base font-semibold text-ink">No activity yet</h2>
          <p className="text-sm text-ink-secondary mt-1 max-w-md mx-auto">
            Actions, approvals, and agent runs will appear here as they happen.
          </p>
        </section>
      ) : (
        <div className="space-y-7">
          {Object.entries(groupedItems).map(([date, dayItems]) => (
            <section key={date} aria-labelledby={`activity-${date}`}>
              <h2 id={`activity-${date}`} className="text-xs font-semibold text-ink-secondary uppercase tracking-wider mb-3">
                {dayLabel(date)}
              </h2>
              <ol className="card divide-y divide-border overflow-hidden">
                {dayItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.id} className="flex items-start gap-3 p-4">
                      <span className="shrink-0 rounded-lg border border-border bg-surface p-2 text-ink-secondary">
                        <Icon size={16} aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-ink">{item.title}</h3>
                          {item.status && (
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusTone(item.status)}`}>
                              {statusLabel(item.status)}
                            </span>
                          )}
                        </div>
                        {item.description && (
                          <p className="text-xs text-ink-secondary mt-1 break-words">{item.description}</p>
                        )}
                        <p className="text-xs text-ink-muted mt-1.5">{item.actor}</p>
                      </div>
                      <time
                        dateTime={item.timestamp}
                        className="shrink-0 flex items-center gap-1 text-[11px] text-ink-muted whitespace-nowrap"
                        title="Times are shown in UTC"
                      >
                        <Clock3 size={12} aria-hidden="true" />
                        {new Date(item.timestamp).toLocaleTimeString("en-US", {
                          timeZone: "UTC",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </time>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}

      {!failedQuery && filteredItems.length > PAGE_SIZE && (
        <nav aria-label="Activity pages" className="flex items-center justify-between mt-6">
          <p className="text-xs text-ink-secondary">
            Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filteredItems.length)} of {filteredItems.length} recent events
          </p>
          <div className="flex items-center gap-2">
            {safePage > 1 && (
              <Link href={pageHref(safePage - 1)} className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-ink hover:bg-surface">
                Previous
              </Link>
            )}
            {safePage < totalPages && (
              <Link href={pageHref(safePage + 1)} className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-ink hover:bg-surface">
                Next
              </Link>
            )}
          </div>
        </nav>
      )}

      <p className="text-[11px] text-ink-muted mt-6">
        Activity history is limited to the most recent 100 records per source. Timestamps are shown in UTC.
      </p>
    </div>
  );
}
