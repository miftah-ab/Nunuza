import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const workspace = await requireWorkspace();
    const db = createServiceClient();
    const { data, error } = await db.from("engagement_actions")
      .select("id,action_type,target_kind,target_post_urn,parent_post_urn,parent_comment_urn,source_text,draft_text,draft_hash,status,expires_at,created_at,published_at,safe_failure_message,metadata")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    const { data: connection } = await db.from("integration_connections")
      .select("status,expires_at,granted_scopes").eq("workspace_id", workspace.id)
      .eq("provider", "linkedin").maybeSingle();
    const scopes = Array.isArray(connection?.granted_scopes) ? connection.granted_scopes : [];
    return NextResponse.json({ actions: data ?? [], capabilities: {
      linkedinConnected: connection?.status === "connected",
      canReadComments: connection?.status === "connected" && scopes.includes("r_member_social_feed"),
      canWriteComments: connection?.status === "connected" && scopes.includes("w_member_social_feed"),
      externalPostDiscovery: false,
    } });
  } catch {
    return NextResponse.json({ error: "Could not load engagement actions." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const body = await request.json() as { id?: string; draftHash?: string; decision?: string };
    if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id) ||
        typeof body.decision !== "string" || !["approve", "reject"].includes(body.decision)) {
      return NextResponse.json({ error: "Invalid engagement decision." }, { status: 400 });
    }
    const db = await createClient();
    if (body.decision === "approve") {
      const serviceDb = createServiceClient();
      const { data: connection } = await serviceDb.from("integration_connections")
        .select("status,expires_at,granted_scopes").eq("workspace_id", workspace.id)
        .eq("provider", "linkedin").maybeSingle();
      const scopes = Array.isArray(connection?.granted_scopes) ? connection.granted_scopes : [];
      if (connection?.status !== "connected" || !scopes.includes("w_member_social_feed")) {
        return NextResponse.json({ error: "LinkedIn comment publishing permission is not available on this connection yet." }, { status: 409 });
      }
      if (typeof body.draftHash !== "string" || !/^[a-f0-9]{64}$/.test(body.draftHash)) {
        return NextResponse.json({ error: "Draft approval token is invalid." }, { status: 400 });
      }
      const { data, error } = await db.rpc("approve_engagement_action", {
        p_action_id: body.id, p_draft_hash: body.draftHash,
      });
      if (error) throw error;
      if (data !== true) return NextResponse.json({ error: "This draft changed, expired, or is no longer awaiting approval." }, { status: 409 });
      return NextResponse.json({ ok: true, status: "approved" });
    }
    const { data, error } = await db.rpc("reject_engagement_action", { p_action_id: body.id });
    if (error) throw error;
    if (data !== true) return NextResponse.json({ error: "This action expired or is no longer awaiting approval." }, { status: 409 });
    return NextResponse.json({ ok: true, status: "rejected" });
  } catch {
    return NextResponse.json({ error: "Could not process engagement approval." }, { status: 500 });
  }
}
