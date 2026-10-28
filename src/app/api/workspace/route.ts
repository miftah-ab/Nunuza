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

    const updates: Record<string, unknown> = {};

    if (typeof body.name === "string" && body.name.trim().length > 0) {
      updates.name = body.name.trim().slice(0, 100);
    }

    if (body.operating_mode) {
      if (body.operating_mode === "autopilot") {
        if (!canUseAutopilot({ entitlement_type: workspace.entitlement_type, operating_mode: "autopilot" })) {
          throw new EntitlementError(
            "paid_active with autopilot clearance",
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

    if (Object.keys(updates).length === 0) {
      return ok({ workspace });
    }

    const supabase = await createClient();
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

    return ok({ workspace: updated });
  } catch (err) {
    return apiError(err);
  }
}
