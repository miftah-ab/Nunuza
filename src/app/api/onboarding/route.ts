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

  /** The question the user just answered, recorded to see where people drop off. */
  onboardingStep?: string;
}

const ONBOARDING_STEP_KEYS = new Set(["name", "role", "goals", "audience", "topics", "tone", "cadence", "connect"]);

/** Free-text answers go into AI prompts, so cap their length and strip control characters. */
function cleanField(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, max);
  return cleaned || undefined;
}

/** Newline-separated list (topics): each line capped, at most 12 lines. */
function cleanLines(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const lines = value.split("\n").map((l) => cleanField(l, 80)).filter(Boolean).slice(0, 12);
  return lines.length ? lines.join("\n") : undefined;
}

export async function POST(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const body = await parseBody<OnboardingBody>(request);

    if (!body) {
      return NextResponse.json(
        { error: "We couldn’t read your setup details. Please try again." },
        { status: 400 }
      );
    }

    // Answers arrive from tapped chips plus free-text "Other" boxes.
    body.displayName = cleanField(body.displayName, 60);
    body.role = cleanField(body.role, 80);
    body.positioning = cleanField(body.positioning, 160);
    body.primaryGoal = cleanField(body.primaryGoal, 300);
    body.audienceRoles = cleanField(body.audienceRoles, 300);
    body.tone = cleanField(body.tone, 120);
    if (typeof body.pillars === "string") body.pillars = cleanLines(body.pillars);
    if (body.timezone !== undefined) body.timezone = cleanField(body.timezone, 64);

    const supabase = await createClient();

    // 1. Update Profile (display_name, timezone)
    const profileUpdates: Record<string, unknown> = {};
    if (body.displayName) profileUpdates.display_name = body.displayName.trim();
    if (body.timezone) profileUpdates.timezone = body.timezone.trim();

    if (Object.keys(profileUpdates).length > 0) {
      const { error: profileError } = await supabase
        .from("profiles")
        .update(profileUpdates)
        .eq("id", workspace.owner_user_id);
      if (profileError) {
        console.error("[onboarding] Profile update failed:", profileError);
        return NextResponse.json({ error: "We couldn’t save your profile details. Please try again." }, { status: 500 });
      }
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

    if (body.onboardingStep && ONBOARDING_STEP_KEYS.has(body.onboardingStep)) {
      try {
        await logAuditEvent({
          workspaceId: workspace.id,
          actorType: "user",
          actorId: workspace.owner_user_id,
          action: "onboarding_step",
          resourceType: "workspace",
          resourceId: workspace.id,
          safeMetadata: { step: body.onboardingStep },
        });
      } catch {
        // Step tracking must never block setup.
      }
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
          console.error("[onboarding] Workspace setup could not be completed:", error);
          return NextResponse.json(
            { error: "We couldn’t finish setting up your workspace. Please try again." },
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
