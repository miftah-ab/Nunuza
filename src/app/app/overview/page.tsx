import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Workspace } from "@/types/database";
import {
  CheckCircle2,
  AlertCircle,
  Clock,
  PauseCircle,
  WifiOff,
  AlertTriangle,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Overview",
  robots: { index: false, follow: false },
};

const STATE_CONFIG = {
  setup_required:          { label: "Setup required",       icon: AlertCircle,    color: "text-warning" },
  active_approval_required:{ label: "Active — review needed", icon: CheckCircle2, color: "text-success" },
  active_autopilot:        { label: "Active — autopilot",   icon: CheckCircle2,   color: "text-success" },
  paused:                  { label: "Paused",               icon: PauseCircle,    color: "text-ink-secondary" },
  blocked_integration:     { label: "Integration issue",    icon: WifiOff,        color: "text-error" },
  attention_required:      { label: "Attention required",   icon: AlertTriangle,  color: "text-warning" },
} as const;

const ENTITLEMENT_BADGES = {
  draft_only:      { label: "Draft-only preview — no subscription required", className: "badge-draft-only" },
  publishing_beta: { label: "LinkedIn publishing beta — no subscription required", className: "badge-beta" },
  internal_test:   { label: "Internal acceptance test", className: "badge-error" },
  paid_trial:      { label: "Trial", className: "badge-active" },
  paid_active:     { label: "Active subscription", className: "badge-active" },
  inactive:        { label: "Inactive", className: "badge-error" },
} as const;

export default async function OverviewPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("*")
    .eq("owner_user_id", user.id)
    .single();

  if (!workspace) redirect("/app/onboarding");

  const ws = workspace as Workspace;
  const stateConfig = STATE_CONFIG[ws.state] ?? STATE_CONFIG.setup_required;
  const StateIcon = stateConfig.icon;
  const badge = ENTITLEMENT_BADGES[ws.entitlement_type];

  // If setup is not complete, redirect to onboarding
  if (ws.state === "setup_required") {
    redirect("/app/onboarding");
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Overview</h1>
          <p className="text-sm text-ink-secondary mt-0.5">
            {ws.name}
          </p>
        </div>
        {badge && (
          <span className={badge.className}>{badge.label}</span>
        )}
      </div>

      {/* Agent state */}
      <div className="card p-5 flex items-center gap-4">
        <StateIcon
          size={20}
          className={stateConfig.color}
          aria-hidden="true"
        />
        <div>
          <p className="text-xs text-ink-secondary font-medium uppercase tracking-widest">
            Agent status
          </p>
          <p className="text-sm font-semibold text-ink mt-0.5">
            {stateConfig.label}
          </p>
        </div>
      </div>

      {/* Draft-only notice */}
      {ws.entitlement_type === "draft_only" && (
        <div className="card border-forest-muted bg-forest-light/40 p-5">
          <p className="text-sm font-semibold text-ink mb-1">
            Draft-only preview
          </p>
          <p className="text-sm text-ink-secondary">
            You can create, review, and export drafts. Publishing and scheduling
            are not available in this release.
          </p>
        </div>
      )}

      {/* Placeholder sections — real data wired in Phase 3 */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="card p-5">
          <p className="section-label mb-2">Drafts awaiting review</p>
          <p className="text-2xl font-bold text-ink">—</p>
          <p className="text-xs text-ink-secondary mt-1">
            Content jobs load in Phase 3
          </p>
        </div>
        <div className="card p-5">
          <p className="section-label mb-2">Recent activity</p>
          <p className="text-2xl font-bold text-ink">—</p>
          <p className="text-xs text-ink-secondary mt-1">
            Agent jobs load in Phase 5
          </p>
        </div>
      </div>
    </div>
  );
}
