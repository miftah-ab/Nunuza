/**
 * POST /api/onboarding — saves onboarding progress and completes setup
 *
 * Implements Notion Spec §6 & BED-07:
 * - Derives workspace strictly from authenticated server session
 * - Updates user profile (display name, timezone)
 * - Persists voice profile (tone, sentence length, phrases, sample text)
 * - Persists content strategy (audience, goals, pillars, cadence, exclusions)
 * - When finishSetup=true: transitions workspace state from setup_required to active_approval_required
 * - Preserves draft_only entitlement without granting publishing or autopilot
 */

import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { ok, apiError, parseBody } from "@/lib/api/respond";
import { createClient } from "@/lib/supabase/server";
import {
  upsertVoiceProfile,
  upsertContentStrategy,
  logAuditEvent,
} from "@/lib/db/workspace";

export interface OnboardingBody {
  // Profile
  displayName?: string;
  role?: string;
  company?: string;
  positioning?: string;
  linkedinUrl?: string;
  timezone?: string;

  // Audience & Strategy
  audienceRoles?: string;
  audienceProblems?: string;
  audienceOutcomes?: string;
  pillars?: string[] | string;
  primaryGoal?: string;
  exclusions?: string[] | string;
  ctaPreferences?: string[] | string;

  // Voice
  tone?: string;
  sentenceLength?: string;
  phrasesUse?: string[] | string;
  phrasesAvoid?: string[] | string;
  sampleWriting?: string;

  // Cadence
  postsPerWeek?: number;
  preferredDays?: number[];

  // Finish setup flag
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

    // 1. Update Profile (display_name, timezone)
    const profileUpdates: Record<string, unknown> = {};
    if (body.displayName) profileUpdates.display_name = body.displayName.trim();
    if (body.timezone) profileUpdates.timezone = body.timezone.trim();

    if (Object.keys(profileUpdates).length > 0) {
      await supabase
        .from("profiles")
        .update(profileUpdates)
        .eq("id", workspace.owner_user_id);
    }

    // 2. Upsert Voice Profile if voice parameters provided
    const hasVoiceData = Boolean(
      body.tone ||
      body.sentenceLength ||
      body.phrasesUse ||
      body.phrasesAvoid ||
      body.sampleWriting
    );

    if (hasVoiceData) {
      const phrasesUse = Array.isArray(body.phrasesUse)
        ? body.phrasesUse
        : body.phrasesUse
        ? body.phrasesUse.split(",").map((s) => s.trim()).filter(Boolean)
        : [];

      const phrasesAvoid = Array.isArray(body.phrasesAvoid)
        ? body.phrasesAvoid
        : body.phrasesAvoid
        ? body.phrasesAvoid.split(",").map((s) => s.trim()).filter(Boolean)
        : [];

      await upsertVoiceProfile(workspace.id, {
        tone: body.tone?.trim(),
        sentence_length: body.sentenceLength?.trim(),
        phrases_use: phrasesUse,
        phrases_avoid: phrasesAvoid,
        sample_text: body.sampleWriting?.trim(),
      });
    }

    // 3. Upsert Content Strategy if strategy/audience/cadence provided
    const hasStrategyData = Boolean(
      body.audienceRoles ||
      body.audienceProblems ||
      body.audienceOutcomes ||
      body.pillars ||
      body.primaryGoal ||
      body.exclusions ||
      body.ctaPreferences ||
      body.postsPerWeek ||
      body.preferredDays ||
      body.role ||
      body.company ||
      body.positioning
    );

    if (hasStrategyData) {
      const pillars = Array.isArray(body.pillars)
        ? body.pillars
        : typeof body.pillars === "string"
        ? body.pillars.split("\n").map((s) => s.trim()).filter(Boolean)
        : [];

      const goals = body.primaryGoal ? [body.primaryGoal.trim()] : [];

      const exclusions = Array.isArray(body.exclusions)
        ? body.exclusions
        : typeof body.exclusions === "string"
        ? body.exclusions.split(",").map((s) => s.trim()).filter(Boolean)
        : [];

      const ctaPreferences = Array.isArray(body.ctaPreferences)
        ? body.ctaPreferences
        : typeof body.ctaPreferences === "string"
        ? body.ctaPreferences.split(",").map((s) => s.trim()).filter(Boolean)
        : [];

      await upsertContentStrategy(workspace.id, {
        audience: {
          roles: body.audienceRoles?.trim() || null,
          problems: body.audienceProblems?.trim() || null,
          outcomes: body.audienceOutcomes?.trim() || null,
          founder_role: body.role?.trim() || null,
          company: body.company?.trim() || null,
          positioning: body.positioning?.trim() || null,
          linkedin_url: body.linkedinUrl?.trim() || null,
        },
        goals,
        pillars,
        cadence_per_week: body.postsPerWeek ?? 3,
        preferred_days: body.preferredDays ?? [1, 2, 3, 4, 5],
        timezone: body.timezone?.trim() || "UTC",
        exclusions,
        cta_preferences: ctaPreferences,
      });
    }

    // 4. Handle finishSetup: transition state from setup_required to active_approval_required
    if (body.finishSetup) {
      let updatedWorkspace = workspace;

      if (workspace.state === "setup_required") {
        const { data: updated, error } = await supabase
          .from("workspaces")
          .update({
            state: "active_approval_required",
            operating_mode: "approval_required",
            updated_at: new Date().toISOString(),
          })
          .eq("id", workspace.id)
          .select()
          .single();

        if (error || !updated) {
          return NextResponse.json(
            { error: "Failed to complete setup." },
            { status: 500 }
          );
        }

        updatedWorkspace = updated;

        await logAuditEvent({
          workspaceId: workspace.id,
          actorType: "user",
          actorId: workspace.owner_user_id,
          action: "complete_onboarding",
          resourceType: "workspace",
          resourceId: workspace.id,
          safeMetadata: {
            previousState: workspace.state,
            newState: "active_approval_required",
            entitlement: workspace.entitlement_type,
          },
        });
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
