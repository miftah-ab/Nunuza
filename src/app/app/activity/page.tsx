import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, AuthError } from "@/lib/auth/workspace";
import {
  Activity,
  CheckCircle2,
  AlertCircle,
  Clock,
  Shield,
  Bot,
  User,
  AlertTriangle,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Activity Log — Nunuza",
  robots: { index: false, follow: false },
};

interface CombinedActivityItem {
  id: string;
  source: "audit" | "job";
  action: string;
  actor: string;
  resource?: string;
  status?: string;
  timestamp: string;
  details?: string;
}

export default async function ActivityPage() {
  let workspace;
  try {
    workspace = await requireWorkspace();
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    redirect("/app/onboarding");
  }

  const supabase = await createClient();

  let activities: CombinedActivityItem[] = [];
  let queryError: string | null = null;

  try {
    const [auditRes, jobsRes] = await Promise.all([
      supabase
        .from("audit_events")
        .select("*")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("agent_jobs")
        .select("*")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    if (auditRes.error) throw new Error(auditRes.error.message);
    if (jobsRes.error) throw new Error(jobsRes.error.message);

    const auditItems: CombinedActivityItem[] = (auditRes.data ?? []).map((a: any) => {
      let detailsString: string | undefined = undefined;
      if (a.safe_metadata && typeof a.safe_metadata === "object") {
        const pairs = Object.entries(a.safe_metadata)
          .filter(([_, v]) => v !== undefined && v !== null && typeof v !== "object")
          .map(([k, v]) => `${k}: ${v}`);
        if (pairs.length > 0) {
          detailsString = pairs.join(" · ");
        }
      }

      return {
        id: `audit-${a.id}`,
        source: "audit",
        action: a.action.replace(/_/g, " "),
        actor: a.actor_type,
        resource: a.resource_type,
        timestamp: a.created_at,
        details: detailsString,
      };
    });

    const jobItems: CombinedActivityItem[] = (jobsRes.data ?? []).map((j: any) => ({
      id: `job-${j.id}`,
      source: "job",
      action: `job: ${j.job_type.replace(/_/g, " ")}`,
      actor: "system",
      status: j.status,
      timestamp: j.created_at,
      details: j.safe_error_message || j.last_error_code || undefined,
    }));

    activities = [...auditItems, ...jobItems].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  } catch (err: unknown) {
    queryError = err instanceof Error ? err.message : "Failed to load activity logs.";
  }

  return (
    <div className="max-w-4xl mx-auto animate-fade-in pb-12">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">Activity Log</h1>
        <p className="text-sm text-ink-secondary mt-1">
          Chronological record of user actions, content updates, and system jobs for {workspace.name}.
        </p>
      </div>

      {queryError ? (
        <div className="card p-6 border-error-light bg-error-light/30">
          <div className="flex items-center gap-2 text-error font-semibold text-sm">
            <AlertCircle size={18} />
            <span>Database Error</span>
          </div>
          <p className="text-xs text-ink-secondary mt-1">{queryError}</p>
        </div>
      ) : activities.length === 0 ? (
        <div className="card p-10 text-center">
          <Activity size={32} className="mx-auto text-ink-secondary/50 mb-3" />
          <h3 className="text-base font-semibold text-ink">No Activity Recorded Yet</h3>
          <p className="text-sm text-ink-secondary mt-1 max-w-md mx-auto">
            Audit events and job execution logs will be listed here automatically as drafts are created,
            strategies are updated, and background jobs run.
          </p>
        </div>
      ) : (
        <div className="card divide-y divide-border overflow-hidden">
          {activities.map((item) => {
            const dateStr = new Date(item.timestamp).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });

            return (
              <div key={item.id} className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 hover:bg-surface/50 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded bg-surface border border-border mt-0.5">
                    {item.source === "job" ? (
                      <Bot size={16} className="text-ink-secondary" />
                    ) : item.actor === "user" ? (
                      <User size={16} className="text-forest" />
                    ) : (
                      <Shield size={16} className="text-ink-secondary" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-ink capitalize">
                        {item.action}
                      </p>
                      <span className="text-[11px] px-1.5 py-0.2 rounded font-mono bg-surface text-ink-secondary border border-border">
                        {item.actor}
                      </span>
                      {item.status && (
                        <span className={`text-[11px] px-1.5 py-0.2 rounded font-mono ${
                          item.status === "succeeded" ? "badge-active" :
                          item.status.startsWith("failed") ? "badge-error" : "badge-beta"
                        }`}>
                          {item.status}
                        </span>
                      )}
                    </div>
                    {item.resource && (
                      <p className="text-xs text-ink-secondary mt-0.5">
                        Target resource: <span className="font-mono text-ink">{item.resource}</span>
                      </p>
                    )}
                    {item.details && (
                      <p className="text-[11px] text-ink-secondary mt-1 font-mono truncate max-w-lg">
                        {item.details}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-xs text-ink-secondary whitespace-nowrap sm:text-right shrink-0">
                  <span className="flex items-center gap-1 sm:justify-end">
                    <Clock size={12} />
                    {dateStr}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
