/**
 * DELETE /api/integrations/linkedin — disconnects LinkedIn connection
 */

import { requireWorkspace } from "@/lib/auth/workspace";
import { ok, apiError } from "@/lib/api/respond";
import { disconnectLinkedIn } from "@/lib/integrations/linkedin/client";

export async function DELETE() {
  try {
    const workspace = await requireWorkspace();
    await disconnectLinkedIn(workspace.id, workspace.owner_user_id);
    return ok({ disconnected: true });
  } catch (err) {
    return apiError(err);
  }
}
