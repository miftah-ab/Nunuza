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
  X,
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
      const botUrl =
        dataPayload.botUrl ||
        `https://t.me/NunuzaBot?start=${dataPayload.token}`;

      setTelegramPairing({
        token: dataPayload.token,
        botUrl,
        expiresAt: dataPayload.expiresAt,
      });

      // Directly open Telegram bot in a new tab/window
      window.open(botUrl, "_blank", "noopener,noreferrer");

      setSuccessMsg("Opening Telegram. Tap Start in the bot to connect.");
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
    void navigator.clipboard.writeText(text).catch(() => {
      setErrorMsg("Clipboard access failed. Select and copy the value manually.");
    });
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
        <div className="notice-error p-4 rounded-lg text-sm flex items-center justify-between">
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg(null)} className="ml-4 hover:opacity-70">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="notice-success p-4 rounded-lg text-sm flex items-center justify-between">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="ml-4 hover:opacity-70">
            <X className="w-4 h-4" />
          </button>
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
                  <span className="badge-active text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-success" /> Connected
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

        {/* Notice on Private Beta vs Commercial access */}
        {data.workspaceEntitlement === "internal_beta" || data.workspaceEntitlement === "publishing_beta" || data.workspaceEntitlement === "internal_test" ? (
          <div className="notice-info mt-4 p-3 rounded-lg text-xs flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Private Beta Active:</span> This workspace has authorized private beta access. Once your LinkedIn profile is connected, human-approved drafts can be scheduled and published directly to your personal profile.
            </div>
          </div>
        ) : data.workspaceEntitlement === "paid_trial" || data.workspaceEntitlement === "paid_active" ? (
          <div className="notice-info mt-4 p-3 rounded-lg text-xs flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Commercial Subscription Active:</span> Full LinkedIn publishing and background scheduling enabled for your workspace.
            </div>
          </div>
        ) : (
          <div className="notice-warning mt-4 p-3 rounded-lg text-xs flex items-start gap-2">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Subscription Required:</span> You can connect LinkedIn now. Live publishing and background scheduling become active upon starting your 14-day free trial ($29/month).
            </div>
          </div>
        )}
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
                  <span className="badge-active text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-success" /> Connected
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
            {/* Pairing Direct Link & Status */}
            {telegramPairing && !data.telegram.connected && (
              <div className="p-4 rounded-lg bg-surface border border-forest-muted bg-forest-light/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Send className="w-4 h-4 text-[#229ED9]" />
                    <span className="text-xs font-semibold text-ink">
                      Connecting to Telegram Bot
                    </span>
                  </div>
                  <span className="badge-active text-[10px] px-2 py-0.5 rounded-full font-medium">
                    Pairing Active
                  </span>
                </div>

                <p className="text-xs text-ink-secondary leading-relaxed">
                  We opened Telegram in a new window. Tap <strong>Start</strong> in the chat to link your workspace automatically.
                </p>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <a
                    href={telegramPairing.botUrl || `https://t.me/NunuzaBot?start=${telegramPairing.token}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary text-xs px-3.5 py-1.5 flex items-center gap-1.5 bg-[#229ED9] hover:bg-[#1b80b0] text-white"
                  >
                    <span>Open in Telegram</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>

                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await fetch("/api/integrations/telegram/link");
                        const json = (await res.json()) as any;
                        const status = json?.data?.status || json?.status;
                        if (status?.linked) {
                          setData((prev) => ({
                            ...prev,
                            telegram: {
                              ...prev.telegram,
                              connected: true,
                              telegramUserId: status.telegramUserId,
                              chatId: status.chatId,
                              linkedAt: status.linkedAt,
                            },
                          }));
                          setTelegramPairing(null);
                          setSuccessMsg("Telegram connected successfully!");
                        } else {
                          setErrorMsg("Waiting for confirmation. Make sure you tapped Start in Telegram.");
                        }
                      } catch {
                        // ignore
                      }
                    }}
                    className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Check Connection</span>
                  </button>
                </div>
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
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg bg-[#DDEFE5] text-[#267253]">
              <Cpu className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
                Claude & Remote MCP
                {!data.mcp.enabled ? (
                  <span className="badge-draft-only text-xs px-2 py-0.5 rounded-full">Integration not enabled</span>
                ) : (
                  <span className="badge-active text-xs px-2 py-0.5 rounded-full">OAuth setup</span>
                )}
              </h2>
              <p className="text-xs text-ink-secondary mt-0.5">
                Connect Claude to your Nunuza workspace using secure OAuth authorization.
              </p>
            </div>
          </div>
          {data.mcp.enabled && (
            <a
              href="https://claude.ai/settings/connectors"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary text-xs px-4 py-2 inline-flex items-center gap-2"
            >
              Connect Claude
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        {!data.mcp.enabled ? (
          <div className="mt-4 p-3 rounded-lg bg-surface border border-border text-xs text-ink-secondary">
            Integration not enabled. The MCP production gate must pass before customers can connect external agents.
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <label className="text-xs text-ink-secondary font-medium block mb-1">Nunuza MCP server URL</label>
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
                  {copiedUrl ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedUrl ? "Copied" : "Copy URL"}
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-[#D7E6DC] bg-[#F4F8F5] p-4 space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-ink">Authorize Nunuza in Claude</h3>
                <p className="mt-1 text-xs leading-5 text-ink-secondary">
                  Add the connector once. Claude will then use OAuth to sign you in and request permission—no Nunuza API key or manual Authorization header.
                </p>
              </div>
              <ol className="list-decimal pl-5 space-y-1.5 text-xs leading-5 text-ink-secondary">
                <li>Open Claude Connectors using the button above.</li>
                <li>Choose <strong className="text-ink">Add custom connector</strong>, name it <strong className="text-ink">Nunuza</strong>, and paste the server URL shown above.</li>
                <li>Choose <strong className="text-ink">Sign in now</strong> or <strong className="text-ink">Sign in when needed</strong>. Choose OAuth authentication (not No sign in). Allow Claude to register as a client if prompted.</li>
                <li>When Claude starts the connection, sign in to Nunuza and review the permissions before approving.</li>
              </ol>
              <p className="text-[11px] leading-5 text-ink-secondary">
                Anthropic currently requires custom connectors to be added in Claude settings. After this one-time setup, reconnecting uses the OAuth consent flow.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-surface border border-border text-xs text-ink-secondary flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 text-ink-secondary mt-0.5" />
              <div>
                <span className="font-semibold text-ink">Human approval stays mandatory:</span> Claude can read workspace data and manage drafts, but it cannot approve drafts or bypass Nunuza&apos;s approval rules. Scheduling is limited to drafts already approved by you.
              </div>
            </div>

            <details className="rounded-lg border border-border p-3">
              <summary className="cursor-pointer text-xs font-semibold text-ink">
                Advanced: API key for other MCP clients
              </summary>
              <div className="mt-3 space-y-3">
                <p className="text-xs text-ink-secondary">
                  Claude uses OAuth above. Generate a legacy workspace key only for another MCP client that does not support OAuth.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleGenerateMcpKey}
                    disabled={loadingAction === "mcp_key"}
                    className="btn-secondary text-xs px-3 py-1.5"
                  >
                    {loadingAction === "mcp_key" ? "Generating..." : data.mcp.active ? "Rotate legacy key" : "Generate legacy key"}
                  </button>
                  {data.mcp.active && (
                    <button
                      onClick={handleRevokeMcpKey}
                      disabled={loadingAction === "mcp_revoke"}
                      className="btn-secondary text-xs px-3 py-1.5 text-red-400 hover:text-red-300"
                    >
                      {loadingAction === "mcp_revoke" ? "Revoking..." : "Revoke legacy key"}
                    </button>
                  )}
                </div>
                {newMcpToken && (
                  <div className="notice-warning p-3 rounded-lg space-y-2">
                    <div className="text-xs font-semibold text-ink">Save this key now. It is shown only once.</div>
                    <div className="flex items-center gap-2">
                      <input readOnly value={newMcpToken} className="input-field text-xs font-mono py-1.5 px-2.5 flex-1 bg-surface text-ink select-all" />
                      <button onClick={() => copyToClipboard(newMcpToken, "key")} className="btn-primary text-xs px-3 py-1.5">
                        {copiedKey ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                )}
                {data.mcp.active && (
                  <p className="text-[11px] text-ink-secondary">
                    Legacy key created {data.mcp.createdAt ? new Date(data.mcp.createdAt).toLocaleString() : "previously"}.
                    Rotating it immediately revokes the previous key.
                  </p>
                )}
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
