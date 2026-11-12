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

import { requireWorkspace } from "@/lib/auth/workspace";
import { ok, apiError } from "@/lib/api/respond";
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
  } catch (err) {
    return apiError(err);
  }
}

