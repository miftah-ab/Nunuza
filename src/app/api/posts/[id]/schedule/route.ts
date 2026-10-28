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
        { error: "scheduledFor timestamp is required." },
        { status: 400 }
      );
    }

    const result = await schedulePost(
      workspace.id,
      postId,
      body.scheduledFor
    );

    return ok(result);
  } catch (err) {
    return apiError(err);
  }
}
