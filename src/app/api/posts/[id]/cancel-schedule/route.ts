/**
 * POST /api/posts/[id]/cancel-schedule — cancels scheduled publication of a post
 */

import { requireWorkspace } from "@/lib/auth/workspace";
import { ok, apiError } from "@/lib/api/respond";
import { cancelScheduledPost } from "@/lib/jobs/scheduling";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const workspace = await requireWorkspace();
    const { id: postId } = await params;

    const post = await cancelScheduledPost(workspace.id, postId);
    return ok({ post });
  } catch (err) {
    return apiError(err);
  }
}
