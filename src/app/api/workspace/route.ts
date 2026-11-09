/**
 * GET   /api/workspace — returns current workspace and user profile
 * PATCH /api/workspace — updates workspace configuration
 *
 * Authorization: Derived from session via requireWorkspace().
 * Never allows client-supplied workspace_id.
 */

import { NextResponse } from "next/server";
import {
  requireWorkspace,
  canUseAutopilot,
  EntitlementError,
} from "@/lib/auth/workspace";
import { ok, apiError, parseBody } from "@/lib/api/respond";
import { createClient } from "@/lib/supabase/server";
import type { OperatingMode } from "@/types/database";

export async function GET() {
  try {
    const workspace = await requireWorkspace();
    const supabase = await createClient();

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", workspace.owner_user_id)
      .single();

    return ok({ workspace, profile });
  } catch (err) {
    return apiError(err);
  }
}

interface UpdateWorkspaceBody {
  name?: string;
  operating_mode?: OperatingMode;
  paused?: boolean;
  displayName?: string;
  timezone?: string;
}

export async function PATCH(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const body = await parseBody<UpdateWorkspaceBody>(request);

    if (!body) {
      return NextResponse.json(
        { error: "Invalid JSON request body." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 1. Update Profile if displayName or timezone supplied
    if (typeof body.displayName === "string" || typeof body.timezone === "string") {
      const profileUpdates: Record<string, string> = {};
      if (typeof body.displayName === "string" && body.displayName.trim().length > 0) {
        profileUpdates.display_name = body.displayName.trim().slice(0, 100);
      }
      if (typeof body.timezone === "string" && body.timezone.trim().length > 0) {
        profileUpdates.timezone = body.timezone.trim();
      }
      if (Object.keys(profileUpdates).length > 0) {
        await supabase
          .from("profiles")
          .update(profileUpdates)
          .eq("id", workspace.owner_user_id);
      }
    }

    // 2. Update Workspace
    const updates: Record<string, unknown> = {};

    if (typeof body.name === "string" && body.name.trim().length > 0) {
      updates.name = body.name.trim().slice(0, 100);
    }

    if (body.operating_mode) {
      if (body.operating_mode === "autopilot") {
        if (!canUseAutopilot({ entitlement_type: workspace.entitlement_type, operating_mode: "autopilot" })) {
          throw new EntitlementError(
            "active subscription or trial",
            workspace.entitlement_type
          );
        }
      }
      updates.operating_mode = body.operating_mode;
    }

    if (typeof body.paused === "boolean") {
      updates.paused_at = body.paused ? new Date().toISOString() : null;
      if (body.paused) {
        updates.state = "paused";
      } else {
        updates.state =
          workspace.operating_mode === "autopilot"
            ? "active_autopilot"
            : "active_approval_required";
      }
    }

    let updatedWorkspace = workspace;
    if (Object.keys(updates).length > 0) {
      const { data: updated, error } = await supabase
        .from("workspaces")
        .update(updates)
        .eq("id", workspace.id)
        .select()
        .single();

      if (error) {
        return NextResponse.json(
          { error: "Failed to update workspace." },
          { status: 500 }
        );
      }
      updatedWorkspace = updated;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", workspace.owner_user_id)
      .single();

    return ok({ workspace: updatedWorkspace, profile });
  } catch (err) {
    return apiError(err);
  }
}
