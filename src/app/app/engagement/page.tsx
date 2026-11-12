import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { EngagementInbox } from "@/components/engagement/EngagementInbox";

export const metadata: Metadata = { title: "Engagement", robots: { index: false, follow: false } };

export default async function EngagementPage() {
  let workspace;
  try { workspace = await requireWorkspace(); } catch { redirect("/app/onboarding"); }
  const db = createServiceClient();
  const [{ data: actions }, { data: connection }, { data: settings }] = await Promise.all([
    db.from("engagement_actions")
      .select("id,action_type,target_kind,source_text,draft_text,draft_hash,status,expires_at,created_at,safe_failure_message,metadata")
      .eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(100),
    db.from("integration_connections").select("status,granted_scopes")
      .eq("workspace_id", workspace.id).eq("provider", "linkedin").maybeSingle(),
    db.from("engagement_settings").select("enabled,daily_limit").eq("workspace_id", workspace.id).maybeSingle(),
  ]);
  const scopes = Array.isArray(connection?.granted_scopes) ? connection.granted_scopes : [];
  return <div className="mx-auto max-w-4xl animate-fade-in pb-12">
    <EngagementInbox initialActions={actions ?? []} initialSettings={settings ?? { enabled: false, daily_limit: 5 }} capabilities={{
      linkedinConnected: connection?.status === "connected",
      canReadComments: connection?.status === "connected" && scopes.includes("r_member_social_feed"),
      canWriteComments: connection?.status === "connected" && scopes.includes("w_member_social_feed"),
      externalPostDiscovery: false,
    }} />
  </div>;
}
