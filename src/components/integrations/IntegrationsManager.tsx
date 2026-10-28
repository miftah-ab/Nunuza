"use client";

/**
 * Interactive Integrations Manager Component.
 *
 * Manages connections and credential lifecycle for:
 * 1. LinkedIn OAuth Integration (Fail-closed publishing gate, AES-256 token encryption).
 * 2. Telegram Bot Integration (Cryptographic pairing tokens, Bot API linking, conversational commands).
 * 3. Remote MCP Server (JSON-RPC 2.0 endpoint, workspace-scoped tokens, absence of approve_draft).
 */

import React, { useState } from "react";
import {
  Linkedin,
  Send,
  Cpu,
  CheckCircle2,
  AlertCircle,
  Key,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  ExternalLink,
  ShieldAlert,
  Info,
} from "lucide-react";

export interface IntegrationStatusData {
  linkedin: {
    connected: boolean;
    memberId?: string;
    profileName?: string;
    expiresAt?: string;
  };
  telegram: {
    enabled: boolean;
    connected: boolean;
    telegramUserId?: number;
    chatId?: number;
    linkedAt?: string;
    lastInteractionAt?: string;
  };
  mcp: {
    enabled: boolean;
    active: boolean;
    keyId?: string;
    createdAt?: string;
    lastUsedAt?: string | null;
    endpointUrl: string;
  };
  workspaceEntitlement: string;
}

export function IntegrationsManager({ initialData }: { initialData: IntegrationStatusData }) {
  const [data, setData] = useState<IntegrationStatusData>(initialData);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [newMcpToken, setNewMcpToken] = useState<string | null>(null);
  const [telegramPairing, setTelegramPairing] = useState<{
    token: string;
    botUrl: string | null;
    expiresAt: string;
  } | null>(null);

  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // ─── LinkedIn Handlers ───
  const handleConnectLinkedIn = () => {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/api/integrations/linkedin/authorize";
  };

  const handleDisconnectLinkedIn = async () => {
    if (!confirm("Are you sure you want to disconnect LinkedIn?")) return;
    setLoadingAction("linkedin_disconnect");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/integrations/linkedin", { method: "DELETE" });
      const json = (await res.json()) as any;
      if (!res.ok) throw new Error(json.error || "Failed to disconnect");
      setData((prev) => ({
        ...prev,
        linkedin: { connected: false },
      }));
      setSuccessMsg("LinkedIn disconnected successfully.");
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoadingAction(null);
    }
  };

  // ─── Telegram Handlers ───
  const handleGenerateTelegramLink = async () => {
    setLoadingAction("telegram_link");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/integrations/telegram/link", { method: "POST" });
      const json = (await res.json()) as any;
      if (!res.ok) throw new Error(json.error || "Failed to generate pairing link");
      const dataPayload = json.data || json;
      setTelegramPairing({
        token: dataPayload.token,
        botUrl: dataPayload.botUrl,
        expiresAt: dataPayload.expiresAt,
      });
      setSuccessMsg("Telegram pairing link generated. Valid for 15 minutes.");
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDisconnectTelegram = async () => {
    if (!confirm("Are you sure you want to unlink Telegram?")) return;
    setLoadingAction("telegram_unlink");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/integrations/telegram/link", { method: "DELETE" });
      const json = (await res.json()) as any;
      if (!res.ok) throw new Error(json.error || "Failed to unlink Telegram");
      setData((prev) => ({
        ...prev,
        telegram: { ...prev.telegram, connected: false },
      }));
      setTelegramPairing(null);
      setSuccessMsg("Telegram unlinked successfully.");
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoadingAction(null);
    }
  };

  // ─── MCP Handlers ───
  const handleGenerateMcpKey = async () => {
    const isRotating = data.mcp.active;
    if (isRotating && !confirm("Generating a new MCP key will immediately revoke your active key. Continue?")) {
      return;
    }

    setLoadingAction("mcp_key");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/integrations/mcp", { method: "POST" });
      const json = (await res.json()) as any;
      if (!res.ok) throw new Error(json.error || "Failed to generate MCP key");
      const dataPayload = json.data || json;
      setNewMcpToken(dataPayload.token);
      setData((prev) => ({
        ...prev,
        mcp: {
          ...prev.mcp,
          active: true,
          keyId: dataPayload.id,
          createdAt: dataPayload.createdAt,
          lastUsedAt: null,
        },
      }));
      setSuccessMsg("New MCP API key created. Copy it now, as it will not be displayed again.");
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleRevokeMcpKey = async () => {
    if (!confirm("Are you sure you want to revoke your MCP key? External agents will lose access immediately.")) {
      return;
    }

    setLoadingAction("mcp_revoke");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/integrations/mcp", { method: "DELETE" });
      const json = (await res.json()) as any;
      if (!res.ok) throw new Error(json.error || "Failed to revoke MCP key");
      setData((prev) => ({
        ...prev,
        mcp: {
          ...prev.mcp,
          active: false,
          keyId: undefined,
          createdAt: undefined,
          lastUsedAt: null,
        },
      }));
      setNewMcpToken(null);
      setSuccessMsg("MCP key revoked.");
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoadingAction(null);
    }
  };

  const copyToClipboard = (text: string, type: "key" | "url") => {
    navigator.clipboard.writeText(text);
    if (type === "key") {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      {/* Alert Banners */}
      {errorMsg && (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-white font-bold text-xs ml-4">✕</button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-white font-bold text-xs ml-4">✕</button>
        </div>
      )}

      {/* ─── 1. LinkedIn Integration ─── */}
      <div className="card p-6 border border-border">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg bg-[#0077B5]/10 text-[#0077B5]">
              <Linkedin className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
                LinkedIn
                {data.linkedin.connected ? (
                  <span className="badge-approved text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Connected
                  </span>
                ) : (
                  <span className="badge-draft-only text-xs px-2 py-0.5 rounded-full">Not connected</span>
                )}
              </h2>
              <p className="text-xs text-ink-secondary mt-0.5">
                Primary channel for personal founder brand publishing.
              </p>
            </div>
          </div>

          <div>
            {data.linkedin.connected ? (
              <button
                onClick={handleDisconnectLinkedIn}
                disabled={loadingAction === "linkedin_disconnect"}
                className="btn-secondary text-xs px-3 py-1.5 text-red-400 hover:text-red-300 border-red-500/20"
              >
                {loadingAction === "linkedin_disconnect" ? "Disconnecting..." : "Disconnect"}
              </button>
            ) : (
              <button
                onClick={handleConnectLinkedIn}
                className="btn-primary text-xs px-4 py-2 flex items-center gap-2 bg-[#0077B5] hover:bg-[#006097] text-white"
              >
                <Linkedin className="w-3.5 h-3.5" /> Connect LinkedIn
              </button>
            )}
          </div>
        </div>

        {/* Notice on draft-only preview and fail-closed publishing */}
        <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Draft-Only Preview Notice:</span> Automatic publishing is disabled for public preview accounts (`draft_only`). Workspaces can plan, generate, and review drafts safely. Live publishing requires verified LinkedIn developer app scopes (`w_member_social`).
          </div>
        </div>
      </div>

      {/* ─── 2. Telegram Bot Integration ─── */}
      <div className="card p-6 border border-border">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg bg-[#229ED9]/10 text-[#229ED9]">
              <Send className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
                Telegram Bot
                {!data.telegram.enabled ? (
                  <span className="badge-draft-only text-xs px-2 py-0.5 rounded-full">Integration not enabled</span>
                ) : data.telegram.connected ? (
                  <span className="badge-approved text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Connected
                  </span>
                ) : (
                  <span className="badge-draft-only text-xs px-2 py-0.5 rounded-full">Not linked</span>
                )}
              </h2>
              <p className="text-xs text-ink-secondary mt-0.5">
                Conversational control for reviewing drafts, pausing agent, and receiving operational alerts.
              </p>
            </div>
          </div>

          {data.telegram.enabled && (
            <div>
              {data.telegram.connected ? (
                <button
                  onClick={handleDisconnectTelegram}
                  disabled={loadingAction === "telegram_unlink"}
                  className="btn-secondary text-xs px-3 py-1.5 text-red-400 hover:text-red-300 border-red-500/20"
                >
                  {loadingAction === "telegram_unlink" ? "Unlinking..." : "Unlink Bot"}
                </button>
              ) : (
                <button
                  onClick={handleGenerateTelegramLink}
                  disabled={loadingAction === "telegram_link"}
                  className="btn-primary text-xs px-4 py-2 flex items-center gap-2 bg-[#229ED9] hover:bg-[#1b80b0] text-white"
                >
                  <Send className="w-3.5 h-3.5" /> Connect Telegram
                </button>
              )}
            </div>
          )}
        </div>

        {!data.telegram.enabled ? (
          <div className="mt-4 p-3 rounded-lg bg-surface border border-border text-xs text-ink-secondary">
            Integration not enabled. Telegram bot controls will be activated once the platform gate passes.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {/* Pairing Modal / Banner */}
            {telegramPairing && (
              <div className="p-4 rounded-lg bg-accent/5 border border-accent/20 space-y-2">
                <p className="text-xs font-semibold text-accent flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5" /> One-Time Pairing Token (Valid for 15 mins)
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={telegramPairing.token}
                    className="input-field text-xs font-mono py-1.5 px-2.5 flex-1 select-all"
                  />
                  {telegramPairing.botUrl && (
                    <a
                      href={telegramPairing.botUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 bg-[#229ED9] hover:bg-[#1b80b0] text-white"
                    >
                      Open Bot <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <p className="text-[11px] text-ink-secondary">
                  Click &ldquo;Open Bot&rdquo; or start the bot and send: <code className="text-ink font-mono">/start {telegramPairing.token}</code>
                </p>
              </div>
            )}

            {data.telegram.connected && (
              <div className="p-3 rounded-lg bg-surface border border-border text-xs space-y-1 text-ink-secondary">
                <p>• <span className="text-ink font-medium">Telegram User ID:</span> {data.telegram.telegramUserId}</p>
                <p>• <span className="text-ink font-medium">Linked At:</span> {data.telegram.linkedAt ? new Date(data.telegram.linkedAt).toLocaleString() : "Active"}</p>
                <p>• <span className="text-ink font-medium">Supported Commands:</span> <code className="text-ink font-mono">/status</code>, <code className="text-ink font-mono">/drafts</code>, <code className="text-ink font-mono">/pause</code>, <code className="text-ink font-mono">/resume</code>, <code className="text-ink font-mono">/report</code>, <code className="text-ink font-mono">/help</code></p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── 3. Remote MCP Server Integration ─── */}
      <div className="card p-6 border border-border">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg bg-purple-500/10 text-purple-400">
              <Cpu className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
                Remote MCP Server
                {!data.mcp.enabled ? (
                  <span className="badge-draft-only text-xs px-2 py-0.5 rounded-full">Integration not enabled</span>
                ) : data.mcp.active ? (
                  <span className="badge-approved text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Active Key
                  </span>
                ) : (
                  <span className="badge-draft-only text-xs px-2 py-0.5 rounded-full">No active key</span>
                )}
              </h2>
              <p className="text-xs text-ink-secondary mt-0.5">
                Model Context Protocol endpoint for external agents (Cursor, Claude Desktop, Antigravity).
              </p>
            </div>
          </div>

          {data.mcp.enabled && (
            <div className="flex items-center gap-2">
              {data.mcp.active && (
                <button
                  onClick={handleRevokeMcpKey}
                  disabled={loadingAction === "mcp_revoke"}
                  className="btn-secondary text-xs px-3 py-1.5 text-red-400 hover:text-red-300 border-red-500/20"
                >
                  {loadingAction === "mcp_revoke" ? "Revoking..." : "Revoke Key"}
                </button>
              )}
              <button
                onClick={handleGenerateMcpKey}
                disabled={loadingAction === "mcp_key"}
                className="btn-primary text-xs px-4 py-2 flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingAction === "mcp_key" ? "animate-spin" : ""}`} />
                {data.mcp.active ? "Rotate Key" : "Generate Key"}
              </button>
            </div>
          )}
        </div>

        {!data.mcp.enabled ? (
          <div className="mt-4 p-3 rounded-lg bg-surface border border-border text-xs text-ink-secondary">
            Integration not enabled. Remote MCP server tools will be activated once the platform gate passes.
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {/* Endpoint URL Display */}
            <div>
              <label className="text-xs text-ink-secondary font-medium block mb-1">
                MCP HTTP Endpoint (JSON-RPC 2.0)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={data.mcp.endpointUrl}
                  className="input-field text-xs font-mono py-1.5 px-3 flex-1 bg-surface select-all"
                />
                <button
                  onClick={() => copyToClipboard(data.mcp.endpointUrl, "url")}
                  className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1"
                >
                  {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedUrl ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            {/* Revealed Key Banner (Single Display) */}
            {newMcpToken && (
              <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-amber-400" /> Save your MCP API Key now
                  </span>
                  <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider">Shown only once</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={newMcpToken}
                    className="input-field text-xs font-mono py-1.5 px-2.5 flex-1 bg-black/40 text-amber-200 select-all"
                  />
                  <button
                    onClick={() => copyToClipboard(newMcpToken, "key")}
                    className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-black font-semibold"
                  >
                    {copiedKey ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedKey ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="text-[11px] text-amber-300/80">
                  This key will not be shown again. It is stored as a cryptographic hash on our servers.
                </p>
              </div>
            )}

            {/* Active Key Status */}
            {data.mcp.active && (
              <div className="p-3 rounded-lg bg-surface border border-border text-xs text-ink-secondary space-y-1">
                <p>• <span className="text-ink font-medium">Key ID:</span> <code className="text-ink font-mono">{data.mcp.keyId}</code></p>
                <p>• <span className="text-ink font-medium">Created:</span> {data.mcp.createdAt ? new Date(data.mcp.createdAt).toLocaleString() : "Active"}</p>
                <p>• <span className="text-ink font-medium">Last Used:</span> {data.mcp.lastUsedAt ? new Date(data.mcp.lastUsedAt).toLocaleString() : "Never"}</p>
              </div>
            )}

            {/* Security Guardrail Reminder */}
            <div className="p-3 rounded-lg bg-surface/50 border border-border text-xs text-ink-secondary flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 text-ink-secondary mt-0.5" />
              <div>
                <span className="font-semibold text-ink">Human-Approval Requirement:</span> Under BED-11 and Section 11 of the Nunuza specification, the <code className="font-mono text-ink">approve_draft</code> tool is strictly omitted from the MCP tool registry. AI agents cannot self-approve drafts. Approvals require explicit action by the founder in the web dashboard or verified Telegram.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
