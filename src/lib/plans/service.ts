/**
 * Content Planning Service.
 *
 * Implements Phase 3 content planning workflow:
 * - Strategic plan generation based on workspace content strategy & cadence
 * - Plan persistence in the `content_plans` table
 * - Conversion of planned topics into drafted posts with usage quota checks
 */

import { createClient } from "@/lib/supabase/server";
import { aiService } from "@/lib/ai/service";
import { getContentStrategy, logAuditEvent } from "@/lib/db/workspace";
import { createPost } from "@/lib/db/posts";
import { checkDraftLimit, incrementDraftCounter } from "@/lib/db/usage";
import type { ContentPlan } from "@/types/database";

export interface PlanGenerationOptions {
  periodDays?: number; // default: 7
  startDate?: string;  // YYYY-MM-DD, defaults to today
}

export async function generateAndSavePlan(
  workspaceId: string,
  userId: string,
  options: PlanGenerationOptions = {}
): Promise<ContentPlan> {
  const { periodDays = 7, startDate } = options;

  if (periodDays < 7 || periodDays > 30) {
    throw new Error("Plan period must be between 7 and 30 days.");
  }

  const strategy = await getContentStrategy(workspaceId);
  if (!strategy) {
    throw new Error("Content strategy not found. Please complete strategy setup before planning.");
  }

  const start = startDate ? new Date(startDate) : new Date();
  const periodStart = start.toISOString().split("T")[0];
  const end = new Date(start);
  end.setDate(end.getDate() + periodDays - 1);
  const periodEnd = end.toISOString().split("T")[0];

  const planResult = await aiService.generatePlan({
    periodStart,
    periodDays,
    cadencePerWeek: strategy.cadence_per_week,
    preferredDays: strategy.preferred_days ?? [],
    strategy: {
      audience: strategy.audience,
      goals: strategy.goals,
      pillars: Array.isArray(strategy.pillars)
        ? strategy.pillars.map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
        : undefined,
      exclusions: strategy.exclusions,
      ctaPreferences: strategy.cta_preferences,
    },
  });

  const supabase = await createClient();

  // Supersede existing active plans for this workspace
  await supabase
    .from("content_plans")
    .update({ status: "superseded", superseded_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("status", "active");

  // Insert the newly generated plan
  const { data: newPlan, error } = await supabase
    .from("content_plans")
    .insert({
      workspace_id: workspaceId,
      strategy_version: strategy.version ?? 1,
      period_start: periodStart,
      period_end: periodEnd,
      status: "active",
      plan_json: {
        summary: planResult.summary,
        topics: planResult.topics,
        providerUsed: planResult.providerUsed,
        modelUsed: planResult.modelUsed,
      },
    })
    .select()
    .single();

  if (error) {
    throw new Error(`[plans] Failed to save plan: ${error.message}`);
  }

  await logAuditEvent({
    workspaceId,
    actorType: "user",
    actorId: userId,
    action: "generate_content_plan",
    resourceType: "content_plan",
    resourceId: newPlan.id,
    safeMetadata: {
      periodStart,
      periodEnd,
      topicsCount: planResult.topics.length,
      providerUsed: planResult.providerUsed,
    },
  });

  return newPlan as ContentPlan;
}

export async function listContentPlans(workspaceId: string): Promise<ContentPlan[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_plans")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`[plans] listContentPlans error: ${error.message}`);
  }

  return (data ?? []) as ContentPlan[];
}

export interface ConvertPlanTopicInput {
  planId: string;
  topic: string;
  pillar?: string;
  angle?: string;
  targetLength?: "short" | "medium" | "long";
}

export async function convertPlanItemToDraft(
  workspaceId: string,
  userId: string,
  input: ConvertPlanTopicInput
) {
  // 1. Quota check
  const usage = await checkDraftLimit(workspaceId);
  if (usage.isAtLimit) {
    throw new Error(
      `Monthly limit reached (${usage.count}/${usage.limit} drafts). Resets on ${usage.resetsOn}.`
    );
  }

  const strategy = await getContentStrategy(workspaceId);

  // 2. Generate post text
  const generationResult = await aiService.generateDraft({
    topic: input.topic,
    pillar: input.pillar,
    notes: input.angle,
    targetLength: input.targetLength ?? "medium",
    strategy: strategy
      ? {
          audience: strategy.audience,
          goals: strategy.goals,
          pillars: Array.isArray(strategy.pillars)
            ? strategy.pillars.map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
            : undefined,
          exclusions: strategy.exclusions,
          ctaPreferences: strategy.cta_preferences,
        }
      : undefined,
  });

  // 3. Create post with plan_id reference
  const post = await createPost(workspaceId, userId, {
    text: generationResult.text,
    internal_title: input.topic,
    pillar: input.pillar ?? generationResult.pillar,
    source_notes: input.angle,
    plan_id: input.planId,
  });

  // 4. Increment usage counter
  await incrementDraftCounter(workspaceId);

  // 5. Audit event
  await logAuditEvent({
    workspaceId,
    actorType: "user",
    actorId: userId,
    action: "convert_plan_topic_to_draft",
    resourceType: "content_post",
    resourceId: post.id,
    safeMetadata: {
      planId: input.planId,
      providerUsed: generationResult.providerUsed,
    },
  });

  return post;
}
