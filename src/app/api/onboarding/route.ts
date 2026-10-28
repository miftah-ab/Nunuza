/**
 * POST /api/onboarding — saves onboarding progress and completes setup
 *
 * Authorization: requireWorkspace() derived from session.
 */

import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { ok, apiError, parseBody } from "@/lib/api/respond";
import { createClient } from "@/lib/supabase/server";

interface OnboardingBody {
  displayName?: string;
  role?: string;
  company?: string;
  positioning?: string;
  linkedinUrl?: string;
  timezone?: string;
  finishSetup?: boolean;
}

export async function POST(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const body = await parseBody<OnboardingBody>(request);

    if (!body) {
      return NextResponse.json(
        { error: "Invalid JSON request body." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Update profile
    const profileUpdates: Record<string, unknown> = {};
    if (body.displayName) profileUpdates.display_name = body.displayName.trim();
    if (body.timezone) profileUpdates.timezone = body.timezone.trim();

    if (Object.keys(profileUpdates).length > 0) {
      await supabase
        .from("profiles")
        .update(profileUpdates)
        .eq("id", workspace.owner_user_id);
    }

    // If finishSetup is requested, transition workspace state from setup_required to active_approval_required
    if (body.finishSetup && workspace.state === "setup_required") {
      const { data: updatedWorkspace, error } = await supabase
        .from("workspaces")
        .update({
          state: "active_approval_required",
          operating_mode: "approval_required",
        })
        .eq("id", workspace.id)
        .select()
        .single();

      if (error) {
        return NextResponse.json(
          { error: "Failed to complete setup." },
          { status: 500 }
        );
      }

      return ok({
        workspace: updatedWorkspace,
        completed: true,
      });
    }

    return ok({
      workspace,
      completed: false,
    });
  } catch (err) {
    return apiError(err);
  }
}
