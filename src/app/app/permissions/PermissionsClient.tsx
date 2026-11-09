"use client";

import { useState } from "react";
import type { Workspace, OperatingMode } from "@/types/database";
import {
  Shield,
  PauseCircle,
  PlayCircle,
  CheckCircle2,
  Lock,
  AlertTriangle,
  Zap,
  UserCheck,
} from "lucide-react";
import Link from "next/link";

interface PermissionsClientProps {
  initialWorkspace: Workspace;
}

export function PermissionsClient({ initialWorkspace }: PermissionsClientProps) {
  const [workspace, setWorkspace] = useState<Workspace>(initialWorkspace);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showAutopilotConfirm, setShowAutopilotConfirm] = useState(false);

  const isPaused = Boolean(workspace.paused_at);
  const isAutopilotEligible =
    workspace.entitlement_type === "internal_beta" ||
    workspace.entitlement_type === "publishing_beta" ||
    workspace.entitlement_type === "paid_trial" ||
    workspace.entitlement_type === "paid_active";

  const handleTogglePause = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: !isPaused }),
      });
      const json = await res.json() as any;
      if (!res.ok) throw new Error(json.error || "Failed to update pause state");

      setWorkspace(json.data.workspace);
      setSuccess(
        !isPaused
          ? "Agent paused. Background jobs and publishing are halted safely."
          : "Agent resumed. Operating according to your configured mode."
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error updating pause state");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectMode = async (mode: OperatingMode) => {
    if (mode === workspace.operating_mode) return;

    if (mode === "autopilot") {
      if (!isAutopilotEligible) {
        setError(
          "Autopilot requires an active 14-day free trial ($29/mo) or subscription."
        );
        return;
      }
      setShowAutopilotConfirm(true);
      return;
    }

    await updateMode("approval_required");
  };

  const updateMode = async (mode: OperatingMode) => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operating_mode: mode }),
      });
      const json = await res.json() as any;
      if (!res.ok) throw new Error(json.error || "Failed to update operating mode");

      setWorkspace(json.data.workspace);
      setShowAutopilotConfirm(false);
      setSuccess(
        mode === "autopilot"
          ? "Bounded Autopilot enabled. Posts will be scheduled automatically within safety caps."
          : "Mode set to Approval Required. Every post needs your explicit confirmation."
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error updating mode");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {error && (
        <div className="notice-error flex items-start gap-2.5">
          <AlertTriangle size={16} className="shrink-0 mt-0.5 text-error" />
          <span className="text-sm text-error">{error}</span>
        </div>
      )}

      {success && (
        <div className="notice-success flex items-start gap-2.5">
          <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-success" />
          <span className="text-sm text-success">{success}</span>
        </div>
      )}

      {/* ─── 1. Master switch ─── */}
      <div className="card p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-forest-light flex items-center justify-center shrink-0">
              <Shield size={16} className="text-forest" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <h2 className="text-sm font-semibold text-ink">Master Agent Switch</h2>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${isPaused
                  ? "bg-warning-light text-warning border-warning/20"
                  : "bg-success-light text-success border-success/20"
                  }`}>
                  {isPaused ? "Paused" : "Active"}
                </span>
              </div>
              <p className="text-sm text-ink-secondary max-w-lg">
                {isPaused
                  ? "Agent is paused. All automated drafting, background jobs, and scheduled publishing are halted safely."
                  : "Agent is running according to your strategy and operating mode."}
              </p>
            </div>
          </div>

          <button
            onClick={handleTogglePause}
            disabled={loading}
            className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isPaused
              ? "bg-forest text-white hover:bg-forest-hover"
              : "bg-error-light text-error hover:bg-error hover:text-white border border-error/20"
              }`}
          >
            {isPaused ? (
              <><PlayCircle size={15} /> Resume Agent</>
            ) : (
              <><PauseCircle size={15} /> Pause Agent</>
            )}
          </button>
        </div>
      </div>

      {/* ─── 2. Operating Mode ─── */}
      <div className="card p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Operating Mode</h2>
          <p className="text-sm text-ink-secondary mt-1">
            Choose whether the agent requires manual confirmation before publishing, or acts autonomously within safety bounds.
          </p>
        </div>

        <div className="grid gap-3">
          {/* Approval Required */}
          <button
            type="button"
            onClick={() => handleSelectMode("approval_required")}
            className={`w-full text-left p-4 rounded-xl border transition-colors ${workspace.operating_mode === "approval_required"
              ? "border-forest bg-forest-light/40"
              : "border-border hover:bg-surface"
              }`}
            aria-pressed={workspace.operating_mode === "approval_required"}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-forest-light flex items-center justify-center shrink-0 mt-0.5">
                  <UserCheck size={15} className="text-forest" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-ink">Approval Required</span>
                    <span className="text-xs text-ink-muted font-medium">(Recommended)</span>
                    {workspace.operating_mode === "approval_required" && (
                      <span className="badge-active">Active</span>
                    )}
                  </div>
                  <p className="text-sm text-ink-secondary">
                    Every generated post enters Needs Review and requires your explicit approval before it can be scheduled or published. Full human-in-the-loop control.
                  </p>
                </div>
              </div>
              <div className={`w-4 h-4 rounded-full border-2 shrink-0 mt-1 ${workspace.operating_mode === "approval_required"
                ? "border-forest bg-forest"
                : "border-border"
                }`} aria-hidden="true" />
            </div>
          </button>

          {/* Autopilot */}
          <button
            type="button"
            onClick={() => handleSelectMode("autopilot")}
            disabled={!isAutopilotEligible}
            className={`w-full text-left p-4 rounded-xl border transition-colors ${!isAutopilotEligible
              ? "opacity-60 cursor-not-allowed border-border bg-surface/30"
              : workspace.operating_mode === "autopilot"
                ? "border-forest bg-forest-light/40"
                : "border-border hover:bg-surface cursor-pointer"
              }`}
            aria-pressed={workspace.operating_mode === "autopilot"}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-forest-light flex items-center justify-center shrink-0 mt-0.5">
                  <Zap size={15} className="text-forest" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-semibold text-ink">Bounded Autopilot</span>
                    {!isAutopilotEligible && (
                      <span className="badge-draft-only flex items-center gap-1">
                        <Lock size={10} /> Trial or Beta required
                      </span>
                    )}
                    {workspace.operating_mode === "autopilot" && (
                      <span className="badge-active">Active</span>
                    )}
                  </div>
                  <p className="text-sm text-ink-secondary">
                    Automatically drafts and queues posts matching your content strategy and cadence. Constrained by strict daily/weekly safety caps server-side.
                  </p>
                  {!isAutopilotEligible && (
                    <p className="text-xs text-warning mt-2 font-medium">
                      Start your 14-day free trial ($29/mo) to enable Autopilot.{" "}
                      <Link href="/app/billing" className="underline underline-offset-2">View billing →</Link>
                    </p>
                  )}
                </div>
              </div>
              <div className={`w-4 h-4 rounded-full border-2 shrink-0 mt-1 ${workspace.operating_mode === "autopilot"
                ? "border-forest bg-forest"
                : "border-border"
                }`} aria-hidden="true" />
            </div>
          </button>
        </div>
      </div>

      {/* ─── 3. Safety caps ─── */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-ink mb-1">Safety Guardrails</h2>
        <p className="text-sm text-ink-secondary mb-4">
          Strict rate limits enforced server-side to protect your personal LinkedIn reputation.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            {
              label: "Daily Publishing Cap",
              value: "1 post / day",
              desc: "Max 1 post published per personal LinkedIn profile per calendar day.",
            },
            {
              label: "Weekly Rolling Cap",
              value: "7 posts / week",
              desc: "Max 7 posts across any rolling 7-day window.",
            },
            {
              label: "Fail-Closed Safety",
              value: "Auto halt",
              desc: "Publishing stops immediately if OAuth tokens expire or API errors occur.",
            },
          ].map(({ label, value, desc }) => (
            <div key={label} className="p-4 rounded-xl bg-surface border border-border">
              <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">{label}</p>
              <p className="text-base font-bold text-ink">{value}</p>
              <p className="text-xs text-ink-secondary mt-1">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Autopilot Confirmation Modal ─── */}
      {showAutopilotConfirm && (
        <div
          className="fixed inset-0 z-50 bg-ink/30 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="autopilot-confirm-title"
        >
          <div className="card max-w-md w-full p-6 shadow-xl animate-fade-in space-y-4">
            <div>
              <h3 id="autopilot-confirm-title" className="text-base font-bold text-ink">
                Enable Bounded Autopilot
              </h3>
              <p className="text-sm text-ink-secondary mt-2 leading-relaxed">
                When Autopilot is enabled, Nunuza will draft and schedule posts according to your configured content pillars and cadence without waiting for per-post manual approval.
              </p>
            </div>

            <div className="p-4 bg-surface rounded-xl border border-border space-y-1.5">
              <p className="text-xs font-semibold text-ink mb-2">Enforced safety controls:</p>
              {[
                "Max 1 post per day, 7 posts per rolling week",
                "Posts respect your configured voice and tone",
                "Pause the agent or switch modes at any time",
              ].map((item) => (
                <div key={item} className="flex items-start gap-2 text-sm text-ink-secondary">
                  <CheckCircle2 size={13} className="text-success shrink-0 mt-0.5" />
                  <span>{item}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setShowAutopilotConfirm(false)}
                className="btn-ghost"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => updateMode("autopilot")}
                className="btn-primary"
              >
                {loading ? "Enabling…" : "Confirm & Enable Autopilot"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
