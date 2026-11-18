import { loadDraftIdentity } from "@/lib/integrations/telegram/draft-preview-data";
import { resolveWebAppSession, UUID_PATTERN } from "@/lib/integrations/telegram/webapp-session";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

/** The full draft for the Telegram reader. Authorised by Telegram's signed initData. */
export async function POST(request: Request): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400, headers: NO_STORE });
  }
  const session = await resolveWebAppSession(body?.initData);
  if (!session) return Response.json({ error: "Open this from your Nunuza Telegram bot." }, { status: 401, headers: NO_STORE });
  if (typeof body?.postId !== "string" || !UUID_PATTERN.test(body.postId)) {
    return Response.json({ error: "Invalid draft." }, { status: 400, headers: NO_STORE });
  }

  const { data: post } = await session.supabase
    .from("content_posts")
    .select("id, text, status, internal_title")
    .eq("id", body.postId)
    .eq("workspace_id", session.workspaceId)
    .maybeSingle();
  if (!post) return Response.json({ error: "This draft is no longer available." }, { status: 404, headers: NO_STORE });

  const identity = await loadDraftIdentity(session.supabase, session.workspaceId);
  return Response.json(
    {
      data: {
        id: post.id,
        title: post.internal_title || "Your LinkedIn draft",
        text: post.text || "",
        // Only drafts waiting for a decision can be approved or rejected here.
        actionable: ["draft", "needs_review"].includes(post.status),
        status: post.status,
        name: identity.name,
        headline: identity.headline,
        avatarUrl: identity.avatarUrl,
      },
    },
    { headers: NO_STORE }
  );
}
