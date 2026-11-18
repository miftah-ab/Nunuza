import { approveDraft, rejectDraft } from "@/lib/integrations/telegram/draft-actions";
import { resolveWebAppSession, UUID_PATTERN } from "@/lib/integrations/telegram/webapp-session";
import { formatScheduledTime } from "@/lib/jobs/agent-scheduling";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

/** Approve or reject from the Telegram reader. Same rules as the chat buttons. */
export async function POST(request: Request): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400, headers: NO_STORE });
  }
  const session = await resolveWebAppSession(body?.initData);
  if (!session) return Response.json({ error: "Open this from your Nunuza Telegram bot." }, { status: 401, headers: NO_STORE });
  if (typeof body?.postId !== "string" || !UUID_PATTERN.test(body.postId) || (body.action !== "approve" && body.action !== "reject")) {
    return Response.json({ error: "Invalid request." }, { status: 400, headers: NO_STORE });
  }

  if (body.action === "reject") {
    const result = await rejectDraft(session.supabase, { workspaceId: session.workspaceId, postId: body.postId, source: "telegram_webapp" });
    if (result.kind === "rejected") return Response.json({ data: { outcome: "rejected" } }, { headers: NO_STORE });
    const message = result.kind === "not_found" ? "This draft is no longer available." : "This draft was already decided.";
    return Response.json({ error: message }, { status: 409, headers: NO_STORE });
  }

  const result = await approveDraft(session.supabase, {
    workspaceId: session.workspaceId,
    postId: body.postId,
    entitlement: session.entitlement,
    source: "telegram_webapp",
  });
  switch (result.kind) {
    case "scheduled":
      return Response.json(
        { data: { outcome: "scheduled", when: formatScheduledTime(result.scheduledFor, result.timezone) } },
        { headers: NO_STORE }
      );
    case "approved_unscheduled":
      return Response.json({ data: { outcome: "approved", reason: result.reason } }, { headers: NO_STORE });
    case "restricted":
      return Response.json({ error: "Your plan does not allow approvals right now." }, { status: 403, headers: NO_STORE });
    case "not_found":
      return Response.json({ error: "This draft is no longer available." }, { status: 404, headers: NO_STORE });
    default:
      return Response.json({ error: "This draft was already decided." }, { status: 409, headers: NO_STORE });
  }
}
