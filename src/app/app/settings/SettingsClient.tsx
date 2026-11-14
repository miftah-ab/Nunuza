"use client";
import { userFacingError } from "@/lib/ui/error-message";

import { useState } from "react";
import type { Workspace, Profile } from "@/types/database";
import { CheckCircle2, AlertCircle, Download, Trash2, Save, User, Database } from "lucide-react";

interface SettingsClientProps {
  userEmail: string;
  initialProfile: Profile | null;
  initialWorkspace: Workspace;
}

export function SettingsClient({
  userEmail,
  initialProfile,
  initialWorkspace,
}: SettingsClientProps) {
  const [workspace, setWorkspace] = useState<Workspace>(initialWorkspace);
  const [displayName, setDisplayName] = useState(initialProfile?.display_name || "");
  const [timezone, setTimezone] = useState(initialProfile?.timezone || "UTC");
  const [workspaceName, setWorkspaceName] = useState(initialWorkspace.name || "");
  const [maxPostsPerDay, setMaxPostsPerDay] = useState(initialWorkspace.max_posts_per_day ?? 10);
  const [maxPostsPer7Days, setMaxPostsPer7Days] = useState(initialWorkspace.max_posts_per_7_days ?? 50);
  const [isSaving, setIsSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSuccess(null);
    setError(null);

    try {
      const res = await fetch("/api/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName,
          timezone,
          name: workspaceName,
          maxPostsPerDay,
          maxPostsPer7Days,
        }),
      });

      const json = (await res.json()) as any;
      if (!res.ok) throw new Error(json.error || "We couldn’t save your settings. Please try again.");

      setWorkspace(json.data.workspace);
      setMaxPostsPerDay(json.data.workspace.max_posts_per_day ?? maxPostsPerDay);
      setMaxPostsPer7Days(json.data.workspace.max_posts_per_7_days ?? maxPostsPer7Days);
      setSuccess("Settings saved successfully.");
    } catch (err: unknown) {
      setError(userFacingError(err, "We couldn’t save your settings. Please try again."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportData = async () => {
    try {
      const res = await fetch("/api/posts");
      const json = (await res.json()) as any;
      const exportObject = {
        exportedAt: new Date().toISOString(),
        user: { email: userEmail, displayName, timezone },
        workspace: {
          id: workspace.id,
          name: workspace.name,
          entitlement: workspace.entitlement_type,
          state: workspace.state,
          operatingMode: workspace.operating_mode,
        },
        posts: json.data || [],
      };

      const dataStr =
        "data:text/json;charset=utf-8," +
        encodeURIComponent(JSON.stringify(exportObject, null, 2));
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute(
        "download",
        `nunuza-workspace-export-${new Date().toISOString().split("T")[0]}.json`
      );
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } catch {
      alert("We couldn’t export your workspace data. Please try again.");
    }
  };

  return (
    <div className="space-y-5">
      {error && (
        <div className="notice-error flex items-start gap-2.5">
          <AlertCircle size={16} className="shrink-0 mt-0.5 text-error" />
          <span className="text-sm text-error">{error}</span>
        </div>
      )}

      {success && (
        <div className="notice-success flex items-start gap-2.5">
          <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-success" />
          <span className="text-sm text-success">{success}</span>
        </div>
      )}

      {/* ─── Profile & Workspace Form ─── */}
      <form onSubmit={handleSave} className="card p-6 space-y-5">
        <div className="flex items-center gap-2 pb-4 border-b border-border">
          <User size={16} className="text-forest shrink-0" />
          <div>
            <h2 className="text-sm font-semibold text-ink">Profile &amp; Workspace</h2>
            <p className="text-xs text-ink-secondary mt-0.5">
              Your personal details and workspace identity.
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="settings-email" className="form-label">
            Sign-in Email
          </label>
          <input
            id="settings-email"
            type="email"
            disabled
            value={userEmail}
            className="input-field"
            aria-describedby="settings-email-hint"
          />
          <p id="settings-email-hint" className="form-hint">
            Linked to your Google OAuth account. Contact support to change.
          </p>
        </div>

        <div>
          <label htmlFor="settings-display-name" className="form-label">
            Display Name
          </label>
          <input
            id="settings-display-name"
            type="text"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="input-field"
            placeholder="Your full name"
          />
        </div>

        <div>
          <label htmlFor="settings-workspace-name" className="form-label">
            Workspace Name
          </label>
          <input
            id="settings-workspace-name"
            type="text"
            required
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            className="input-field"
            placeholder="e.g. My LinkedIn Workspace"
          />
        </div>

        <div>
          <label htmlFor="settings-timezone" className="form-label">
            Time Zone
          </label>
          <input
            id="settings-timezone"
            type="text"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="input-field font-mono"
            placeholder="e.g. UTC, America/New_York, Europe/London"
            aria-describedby="settings-timezone-hint"
          />
          <p id="settings-timezone-hint" className="form-hint">
            Used for scheduling and cadence calculations.
          </p>
        </div>

        <div className="border-t border-border pt-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-ink">LinkedIn Publishing Limits</h3>
            <p className="text-xs text-ink-secondary mt-1">
              Set the maximum number of approved posts Nunuza can publish or schedule for this workspace.
              These limits apply across immediate publishing and scheduled posts. They are safety ceilings, not posting targets; prioritize useful content over volume.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="settings-daily-post-limit" className="form-label">Maximum posts per day</label>
              <input
                id="settings-daily-post-limit"
                type="number"
                min={1}
                max={10}
                step={1}
                required
                value={maxPostsPerDay}
                onChange={(e) => {
                  const next = Math.min(10, Math.max(1, Number(e.target.value) || 1));
                  setMaxPostsPerDay(next);
                  setMaxPostsPer7Days((current) => Math.max(current, next));
                }}
                className="input-field"
              />
              <p className="form-hint">Choose between 1 and 10 posts.</p>
            </div>
            <div>
              <label htmlFor="settings-weekly-post-limit" className="form-label">Maximum posts per rolling 7 days</label>
              <input
                id="settings-weekly-post-limit"
                type="number"
                min={maxPostsPerDay}
                max={50}
                step={1}
                required
                value={maxPostsPer7Days}
                onChange={(e) => setMaxPostsPer7Days(Math.min(50, Math.max(maxPostsPerDay, Number(e.target.value) || maxPostsPerDay)))}
                className="input-field"
              />
              <p className="form-hint">Choose between {maxPostsPerDay} and 50 posts.</p>
            </div>
          </div>
          <p className="text-xs text-ink-secondary">
            Current allowance: {maxPostsPerDay} per day and {maxPostsPer7Days} per rolling 7 days.
            Every post still requires approval before publishing.
          </p>
        </div>

        <div className="pt-1 flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="btn-primary"
          >
            <Save size={15} />
            {isSaving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>

      {/* ─── Data Export ─── */}
      <div className="card p-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <Database size={16} className="text-forest" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-ink">Data Portability &amp; Export</h2>
            <p className="text-sm text-ink-secondary mt-1">
              Download a complete archive of your workspace profile, strategy, and content posts in JSON format. Available at any time, including after cancellation.
            </p>
          </div>
          <button
            onClick={handleExportData}
            className="btn-secondary shrink-0"
          >
            <Download size={15} />
            Export All Data
          </button>
        </div>
      </div>

      {/* ─── Account Deletion ─── */}
      <div className="card p-6 border-error/20 bg-error-light/20">
        <div className="flex items-start gap-3">
          <Trash2 size={16} className="text-error shrink-0 mt-0.5" />
          <div>
            <h2 className="text-sm font-semibold text-ink">Workspace &amp; Account Deletion</h2>
            <p className="text-sm text-ink-secondary mt-1 max-w-xl">
              To permanently delete your workspace and all associated content posts, voice profiles, and audit logs, export your content archive first and email{" "}
              <strong className="text-ink">support@nunuza.com</strong> from your registered email. Deletion requests are processed within 48 hours.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
