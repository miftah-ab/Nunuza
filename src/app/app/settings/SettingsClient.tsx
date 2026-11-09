"use client";

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
        }),
      });

      const json = (await res.json()) as any;
      if (!res.ok) throw new Error(json.error || "Failed to update settings");

      setWorkspace(json.data.workspace);
      setSuccess("Settings saved successfully.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error saving settings");
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
      alert("Failed to export workspace data.");
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
