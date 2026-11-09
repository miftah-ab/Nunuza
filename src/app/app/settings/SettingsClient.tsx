"use client";

import { useState } from "react";
import type { Workspace, Profile } from "@/types/database";
import { CheckCircle2, AlertCircle, Download, Trash2, Save } from "lucide-react";

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
      setSuccess("Settings updated successfully.");
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
    <div className="space-y-6">
      {error && (
        <div className="p-3.5 bg-danger/10 border border-danger/20 rounded-lg text-danger text-xs flex items-center gap-2">
          <AlertCircle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-xs flex items-center gap-2">
          <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
          <span>{success}</span>
        </div>
      )}

      {/* ─── Profile & Workspace Form ─── */}
      <form onSubmit={handleSave} className="card p-6 border border-border space-y-4">
        <div>
          <h2 className="text-base font-semibold text-ink">General Profile</h2>
          <p className="text-xs text-ink-secondary mt-0.5">
            Your personal details and workspace identity.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-ink mb-1">
            Sign-in Email
          </label>
          <input
            type="email"
            disabled
            value={userEmail}
            className="input-field text-sm opacity-70 cursor-not-allowed bg-surface"
          />
          <p className="text-[11px] text-ink-secondary mt-1">
            Linked to your Google OAuth account.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-ink mb-1">
            Display Name
          </label>
          <input
            type="text"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="input-field text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-ink mb-1">
            Workspace Name
          </label>
          <input
            type="text"
            required
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            className="input-field text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-ink mb-1">
            Time Zone
          </label>
          <input
            type="text"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="input-field text-sm font-mono"
            placeholder="e.g. UTC, America/New_York, Europe/London"
          />
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="btn-primary text-xs flex items-center gap-1.5"
          >
            <Save size={14} />
            {isSaving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </form>

      {/* ─── Data Export ─── */}
      <div className="card p-6 border border-border">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-ink">Data Portability &amp; Export</h2>
            <p className="text-xs text-ink-secondary mt-0.5">
              Download a complete archive of your workspace profile, strategy, and content posts in JSON format.
            </p>
          </div>
          <button
            onClick={handleExportData}
            className="btn-secondary text-xs flex items-center gap-1.5 self-start whitespace-nowrap"
          >
            <Download size={14} /> Export All Data
          </button>
        </div>
      </div>

      {/* ─── Account Deletion ─── */}
      <div className="card p-6 border border-danger/20 bg-danger/5">
        <div>
          <h2 className="text-base font-semibold text-ink flex items-center gap-2">
            <Trash2 size={16} className="text-danger" /> Workspace &amp; Account Deletion
          </h2>
          <p className="text-xs text-ink-secondary mt-1 max-w-xl">
            To permanently delete your workspace and all associated content posts, voice profiles, and audit logs, please export your content archive first and email support at <strong className="text-ink">support@nunuza.com</strong> from your registered email. Deletion requests are processed within 48 hours.
          </p>
        </div>
      </div>
    </div>
  );
}

