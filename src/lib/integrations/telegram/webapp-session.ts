import { createServiceClient } from "@/lib/supabase/server";
import { verifyWebAppInitData } from "./webapp-auth";

export interface WebAppSession {
  supabase: any;
  telegramUserId: number;
  workspaceId: string;
  entitlement: string;
}

/**
 * Turns the Mini App's `initData` into the linked Nunuza workspace, or null.
 * Telegram signs initData, so a caller cannot act for a workspace that is not
 * linked to their own Telegram account.
 */
export async function resolveWebAppSession(initData: unknown): Promise<WebAppSession | null> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (typeof initData !== "string" || !botToken?.trim()) return null;
  const user = await verifyWebAppInitData(initData, botToken);
  if (!user) return null;

  const supabase = createServiceClient();
  const { data: link } = await supabase
    .from("telegram_links")
    .select("workspace_id")
    .eq("telegram_user_id", user.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (!link?.workspace_id) return null;

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("entitlement_type")
    .eq("id", link.workspace_id)
    .maybeSingle();
  if (!workspace) return null;

  return {
    supabase,
    telegramUserId: user.id,
    workspaceId: link.workspace_id,
    entitlement: workspace.entitlement_type || "draft_only",
  };
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
