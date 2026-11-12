import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const workspace = await requireWorkspace();
    const db = createServiceClient();
    const [items, unread] = await Promise.all([
      db.from("notification_events").select("id,category,priority,title,body,href,read_at,created_at")
        .eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(50),
      db.from("notification_events").select("id", { count: "exact", head: true })
        .eq("workspace_id", workspace.id).is("read_at", null),
    ]);
    if (items.error || unread.error) throw new Error("Notification inbox unavailable.");
    return NextResponse.json({ notifications: items.data ?? [], unreadCount: unread.count ?? 0 });
  } catch {
    return NextResponse.json({ error: "Could not load notifications." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const body = await request.json() as { id?: string; all?: boolean };
    const db = createServiceClient();
    let query = db.from("notification_events").update({ read_at: new Date().toISOString() })
      .eq("workspace_id", workspace.id).is("read_at", null);
    if (body.all === true) {
      const { error } = await query;
      if (error) throw error;
    } else if (typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id)) {
      const { error } = await db.from("notification_events").update({ read_at: new Date().toISOString() })
        .eq("workspace_id", workspace.id).eq("id", body.id).is("read_at", null);
      if (error) throw error;
    } else {
      return NextResponse.json({ error: "A notification ID is required." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not update notification." }, { status: 500 });
  }
}
