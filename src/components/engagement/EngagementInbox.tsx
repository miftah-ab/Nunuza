"use client";

import { useState } from "react";

type Action = {
  id: string; action_type: string; target_kind: string; source_text: string | null;
  draft_text: string; draft_hash: string; status: string; expires_at: string;
  created_at: string; safe_failure_message: string | null; metadata: Record<string, unknown>;
};
type Capabilities = {
  linkedinConnected: boolean; canReadComments: boolean; canWriteComments: boolean; externalPostDiscovery: boolean;
};

export function EngagementInbox({ initialActions, capabilities }: { initialActions: Action[]; capabilities: Capabilities }) {
  const [actions, setActions] = useState(initialActions);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function decide(action: Action, decision: "approve" | "reject") {
    setBusy(action.id); setError("");
    try {
      const response = await fetch("/api/engagement", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: action.id, decision, draftHash: action.draft_hash }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not process this decision.");
      setActions(current => current.map(item => item.id === action.id ? { ...item, status: decision === "approve" ? "approved" : "rejected" } : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not process this decision.");
    } finally { setBusy(null); }
  }

  return <div className="space-y-6">
    <div>
      <h1 className="text-2xl font-semibold text-[#202522]">Engagement</h1>
      <p className="mt-1 text-sm text-[#68716C]">Review suggested LinkedIn replies. Nunuza never publishes without your approval.</p>
    </div>

    <div className="rounded-xl border border-[#E4E8E3] bg-white p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-medium text-[#202522]">LinkedIn comment access</span>
        <span className={capabilities.linkedinConnected ? "text-sm text-[#287A50]" : "text-sm text-[#A86412]"}>
          {capabilities.linkedinConnected ? "Connected" : "Not connected"}
        </span>
      </div>
      <p className="text-sm text-[#68716C]">Read comments: {capabilities.canReadComments ? "Enabled" : "Not granted"} · Publish replies: {capabilities.canWriteComments ? "Enabled" : "Not granted"}</p>
      {!capabilities.canReadComments || !capabilities.canWriteComments ? (
        <p className="text-sm text-[#A86412]">LinkedIn has not granted the restricted comment permissions to this app connection. Monitoring and publishing remain disabled until access is approved and the account is reconnected.</p>
      ) : null}
      <p className="text-xs text-[#68716C]">Automatic discovery of posts across the LinkedIn feed is not currently supported by the connected API access.</p>
    </div>

    {error ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
    <div className="space-y-3">
      {actions.length === 0 ? <div className="rounded-xl border border-[#E4E8E3] bg-white p-8 text-center text-sm text-[#68716C]">No engagement suggestions yet.</div> : actions.map(action => (
        <article key={action.id} className="rounded-xl border border-[#E4E8E3] bg-white p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-[#202522]">Reply to a comment on your post</span>
            <span className="rounded-full bg-[#F8F8F5] px-2.5 py-1 text-xs text-[#68716C]">{action.status.replaceAll("_", " ")}</span>
          </div>
          {action.source_text ? <div className="rounded-lg bg-[#F8F8F5] p-3"><p className="text-xs font-medium text-[#68716C] mb-1">Original comment</p><p className="whitespace-pre-wrap text-sm text-[#202522]">{action.source_text}</p></div> : null}
          <div><p className="text-xs font-medium text-[#68716C] mb-1">Suggested reply</p><p className="whitespace-pre-wrap text-sm text-[#202522]">{action.draft_text}</p></div>
          {action.safe_failure_message ? <p className="text-sm text-[#A86412]">{action.safe_failure_message}</p> : null}
          {action.status === "awaiting_approval" ? <div className="flex flex-wrap gap-2 pt-1">
            <button disabled={busy === action.id || !capabilities.canWriteComments} onClick={() => decide(action, "approve")} className="rounded-lg bg-[#174C3C] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy === action.id ? "Saving…" : "Approve reply"}</button>
            <button disabled={busy === action.id} onClick={() => decide(action, "reject")} className="rounded-lg border border-[#E4E8E3] px-4 py-2 text-sm font-medium text-[#202522] disabled:opacity-50">Reject</button>
          </div> : null}
          <p className="text-xs text-[#68716C]">Expires {new Date(action.expires_at).toLocaleString()}</p>
        </article>
      ))}
    </div>
  </div>;
}
