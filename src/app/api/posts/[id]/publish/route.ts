/**
 * POST /api/posts/[id]/publish — immediately publishes an approved post to LinkedIn.
 *
 * Implements Nunuza Simple Publish Now Feature:
 * - Enqueues post into agent_jobs with publish_post type and idempotency key
 * - Reuses existing authorization, entitlement, LinkedIn connection, approval,
 *   idempotency, retry, reconciliation, and posting-limit checks
 * - Prevents duplicate publishing
 * - Returns execution outcome directly
 */

import { NextResponse } from "next/server";
import { requireWorkspace, AuthError, ForbiddenError, EntitlementError } from "@/lib/auth/workspace";
import { ok } from "@/lib/api/respond";
import { publishPostNow } from "@/lib/jobs/scheduling";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const workspace = await requireWorkspace();
    const { id: postId } = await params;

    const result = await publishPostNow(workspace.id, postId);

    return ok(result);
  } catch (err: any) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof EntitlementError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }

    // Return actionable user-facing error message
    console.error("[api/publish] Publish Now failed:", err.message);
    return NextResponse.json(
      { error: err.message || "Failed to publish post to LinkedIn." },
      { status: 400 }
    );
  }
}

