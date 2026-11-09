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
  Clock,
  Sparkles,
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
          ? "Agent is now paused. Background jobs and publishing will halt safely."
          : "Agent resumed. Operating according to configured mode."
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
          "Autopilot requires an active 14-day free trial ($29/mo) or authorized private beta access."
        );
        return;
      }
      setShowAutopilotConfirm(true);
      return;
    }

    // Switch back to approval_required
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
          : "Operating mode set to Approval Required. Every post requires your explicit confirmation."
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error updating mode");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3.5 bg-danger/10 border border-danger/20 rounded-lg text-danger text-xs flex items-center gap-2">
          <AlertTriangle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-xs flex items-center gap-2">
          <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
          <span>{success}</span>
        </div>
      )}

      {/* ─── 1. Agent Pause / Resume ─── */}
      <div className="card p-6 border border-border">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Shield size={18} className="text-forest" />
              <h2 className="text-base font-semibold text-ink">Master Agent Switch</h2>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-mono ${isPaused ? "badge-inactive" : "badge-active"
                  }`}
              >
                {isPaused ? "Paused" : "Active"}
              </span>
            </div>
            <p className="text-xs text-ink-secondary max-w-xl">
              {isPaused
                ? "Agent is paused. All automated drafting, background jobs, and scheduled publishing are halted safely."
                : "Agent is actively running according to your strategy and operating mode."}
            </p>
          </div>

          <button
            onClick={handleTogglePause}
            disabled={loading}
            className={`text-xs px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors ${isPaused
              ? "bg-forest text-white hover:bg-forest/90"
              : "bg-danger/10 text-danger hover:bg-danger/20 border border-danger/30"
              }`}
          >
            {isPaused ? (
              <>
                <PlayCircle size={15} /> Resume Agent
              </>
            ) : (
              <>
                <PauseCircle size={15} /> Pause Agent
              </>
            )}
          </button>
        </div>
      </div>

      {/* ─── 2. Operating Mode ─── */}
      <div className="card p-6 border border-border space-y-4">
        <div>
          <h2 className="text-base font-semibold text-ink">Operating Mode</h2>
          <p className="text-xs text-ink-secondary mt-0.5">
            Choose whether the agent requires manual confirmation before publishing or acts autonomously.
          </p>
        </div>

        <div className="grid gap-3">
          {/* Approval Required */}
          <div
            onClick={() => handleSelectMode("approval_required")}
            className={`p-4 rounded-xl border cursor-pointer transition-colors ${workspace.operating_mode === "approval_required"
              ? "border-forest bg-forest-light/40"
              : "border-border hover:bg-surface-raised"
              }`}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-ink text-sm">
                    Approval Required (Recommended)
                  </span>
                  {workspace.operating_mode === "approval_required" && (
                    <span className="badge-active text-[10px]">Active</span>
                  )}
                </div>
                <p className="text-xs text-ink-secondary mt-1">
                  Every generated post enters Needs Review and requires your explicit approval before it can be scheduled or published. Full human-in-the-loop control.
                </p>
              </div>
              <input
                type="radio"
                name="operating_mode"
                checked={workspace.operating_mode === "approval_required"}
                onChange={() => handleSelectMode("approval_required")}
                className="mt-1"
              />
            </div>
          </div>

          {/* Autopilot */}
          <div
            onClick={() => handleSelectMode("autopilot")}
            className={`p-4 rounded-xl border transition-colors ${!isAutopilotEligible
              ? "opacity-60 cursor-not-allowed border-border bg-surface/30"
              : workspace.operating_mode === "autopilot"
                ? "border-forest bg-forest-light/40 cursor-pointer"
                : "border-border hover:bg-surface-raised cursor-pointer"
              }`}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-ink text-sm">
                    Bounded Autopilot
                  </span>
                  {!isAutopilotEligible && (
                    <span className="badge-draft-only text-[10px] flex items-center gap-1">
                      <Lock size={10} /> Subscription or Beta Required
                    </span>
                  )}
                  {workspace.operating_mode === "autopilot" && (
                    <span className="badge-active text-[10px]">Active</span>
                  )}
                </div>
                <p className="text-xs text-ink-secondary mt-1">
                  Automatically drafts and queues posts matching your content strategy and target cadence. Constrained by strict daily/weekly safety caps.
                </p>
                {!isAutopilotEligible && (
                  <p className="text-[11px] text-amber-600 mt-2 font-medium">
                    Start your 14-day free trial ($29/mo) or contact your administrator for private beta access to enable Autopilot.
                  </p>
                )}
              </div>
              <input
                type="radio"
                name="operating_mode"
                disabled={!isAutopilotEligible}
                checked={workspace.operating_mode === "autopilot"}
                onChange={() => handleSelectMode("autopilot")}
                className="mt-1"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ─── 3. Hard Safety Caps & Policies ─── */}
      <div className="card p-6 border border-border">
        <h2 className="text-base font-semibold text-ink mb-1">Safety Guardrails &amp; Product Caps</h2>
        <p className="text-xs text-ink-secondary mb-4">
          Strict rate limits enforced server-side to protect your personal LinkedIn reputation.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3.5 rounded-lg bg-surface border border-border">
            <span className="text-ink-secondary block mb-1">Daily Publishing Cap</span>
            <span className="font-bold text-ink text-base">1 post / day</span>
            <p className="text-[11px] text-ink-secondary mt-1">
              Max 1 post published per personal LinkedIn profile per calendar day.
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-surface border border-border">
            <span className="text-ink-secondary block mb-1">Weekly Rolling Cap</span>
            <span className="font-bold text-ink text-base">7 posts / week</span>
            <p className="text-[11px] text-ink-secondary mt-1">
              Max 7 posts across any rolling 7-day window.
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-surface border border-border">
            <span className="text-ink-secondary block mb-1">Fail-Closed Safety</span>
            <span className="font-bold text-ink text-base">Automatic Halt</span>
            <p className="text-[11px] text-ink-secondary mt-1">
              Publishing stops immediately if OAuth tokens expire or API errors occur.
            </p>
          </div>
        </div>
      </div>

      {/* ─── Autopilot Confirmation Modal ─── */}
      {showAutopilotConfirm && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card max-w-md w-full p-6 shadow-xl animate-fade-in space-y-4">
            <div className="flex items-center gap-2 text-forest">
              <Sparkles size={20} />
              <h3 className="font-bold text-ink text-base">Enable Bounded Autopilot</h3>
            </div>

            <p className="text-xs text-ink-secondary leading-relaxed">
              When Autopilot is enabled, Nunuza will draft and schedule posts according to your configured content pillars and cadence without waiting for manual per-post approval.
            </p>

            <div className="p-3 bg-surface rounded-lg text-xs text-ink space-y-1 border border-border">
              <p className="font-semibold text-ink">Enforced Safety Controls:</p>
              <p>• Max 1 post per day, 7 posts per rolling week</p>
              <p>• Posts respect your configured writing voice and tone</p>
              <p>• You can pause the agent or switch back at any time</p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowAutopilotConfirm(false)}
                className="btn-ghost text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => updateMode("autopilot")}
                className="btn-primary text-xs"
              >
                {loading ? "Enabling..." : "Confirm & Enable Autopilot"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

