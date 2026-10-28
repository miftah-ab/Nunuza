import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { IntegrationsManager, type IntegrationStatusData } from "@/components/integrations/IntegrationsManager";
import { getTelegramLinkStatus } from "@/lib/integrations/telegram/service";
import { getMcpCredentialStatus } from "@/lib/integrations/mcp/tokens";

export const metadata: Metadata = {
  title: "Integrations — Nunuza",
  robots: { index: false },
};

export default async function IntegrationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const workspace = await requireWorkspace();

  // 1. Check LinkedIn connection status
  const { data: linkedinConn } = await supabase
    .from("integration_connections")
    .select("status, expires_at, metadata")
    .eq("workspace_id", workspace.id)
    .eq("provider", "linkedin")
    .eq("status", "connected")
    .maybeSingle();

  // 2. Check Telegram link status
  const telegramStatus = await getTelegramLinkStatus(workspace.id, supabase);

  // 3. Check MCP credential status
  const mcpStatus = await getMcpCredentialStatus(workspace.id, supabase);

  // Determine enabled gates (BED-07, BED-09, BED-11)
  const telegramEnabled = process.env.TELEGRAM_ENABLED !== "false";
  const mcpEnabled = process.env.MCP_ENABLED !== "false";

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";
  const endpointUrl = `${appUrl.replace(/\/$/, "")}/api/mcp`;

  const initialData: IntegrationStatusData = {
    linkedin: {
      connected: !!linkedinConn,
      profileName: linkedinConn?.metadata?.name,
      expiresAt: linkedinConn?.expires_at,
    },
    telegram: {
      enabled: telegramEnabled,
      connected: telegramStatus.linked,
      telegramUserId: telegramStatus.telegramUserId,
      chatId: telegramStatus.chatId,
      linkedAt: telegramStatus.linkedAt,
      lastInteractionAt: telegramStatus.lastInteractionAt,
    },
    mcp: {
      enabled: mcpEnabled,
      active: mcpStatus.active,
      keyId: mcpStatus.id,
      createdAt: mcpStatus.createdAt,
      lastUsedAt: mcpStatus.lastUsedAt,
      endpointUrl,
    },
    workspaceEntitlement: workspace.entitlement_type,
  };

  return (
    <div className="max-w-4xl mx-auto animate-fade-in py-2">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">Integrations & Channels</h1>
        <p className="text-sm text-ink-secondary mt-1">
          Connect your LinkedIn profile, Telegram conversational bot, and remote MCP agents.
        </p>
      </div>

      <IntegrationsManager initialData={initialData} />
    </div>
  );
}
