/**
 * POST /api/posts/[id]/schedule — schedules an approved post for publication
 *
 * Enforces server-side entitlement gate: draft_only workspaces are blocked with 403.
 * Enforces rate caps (1 post/day, 7 posts/rolling 7 days).
 */

import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { ok, apiError, parseBody } from "@/lib/api/respond";
import { schedulePost } from "@/lib/jobs/scheduling";
import { notifyWorkspaceTelegram } from "@/lib/integrations/telegram/service";

interface ScheduleBody {
  scheduledFor: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const workspace = await requireWorkspace();
    const { id: postId } = await params;
    const body = await parseBody<ScheduleBody>(request);

    if (!body || !body.scheduledFor) {
      return NextResponse.json(
        { error: "Choose when you’d like this post to be published." },
        { status: 400 }
      );
    }

    const result = await schedulePost(
      workspace.id,
      postId,
      body.scheduledFor
    );

    // Proactive notification to linked Telegram chat
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    notifyWorkspaceTelegram(workspace.id, {
      text:
        `📅 **Post Scheduled**\n\n` +
        `Your post has been scheduled for publishing on:\n` +
        `🕒 **${new Date(body.scheduledFor).toUTCString()}**`,
      replyMarkup: {
        inline_keyboard: [
          [{ text: "📅 View Calendar", url: `${appUrl}/app/calendar` }],
        ],
      },
    }).catch(() => {});

    return ok(result);
  } catch (err) {
    return apiError(err);
  }
}
