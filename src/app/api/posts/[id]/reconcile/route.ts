/**
 * POST /api/posts/[id]/reconcile
 *
 * Resolves a publication LinkedIn did not confirm (post status 'needs_reconciliation').
 * Nunuza never guesses: the customer checks their LinkedIn profile and tells us the outcome.
 *
 * Body: { outcome: "published" | "not_published" }
 *  - published:     the post is recorded as published (no LinkedIn ID is invented; the
 *                   ID is stored only if LinkedIn had actually returned one).
 *  - not_published: the post returns to 'approved' so it can be published again.
 */

import { NextResponse } from "next/server";
import { requireWorkspace, ForbiddenError } from "@/lib/auth/workspace";
import { createServiceClient } from "@/lib/supabase/server";
import { ok, apiError, parseBody } from "@/lib/api/respond";
import { logAuditEvent } from "@/lib/db/workspace";
import { transitionJob } from "@/lib/jobs/state";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const workspace = await requireWorkspace();

    const body = await parseBody<{ outcome?: string }>(request);
    if (!body || (body.outcome !== "published" && body.outcome !== "not_published")) {
      return NextResponse.json(
        { error: "outcome must be 'published' or 'not_published'." },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    const { data: post, error: postErr } = await supabase
      .from("content_posts")
      .select("id, status")
      .eq("id", id)
      .eq("workspace_id", workspace.id)
      .maybeSingle();

    if (postErr || !post) throw new ForbiddenError("Post not found.");
    if (post.status !== "needs_reconciliation") {
      return NextResponse.json(
        { error: "This post is not waiting for publication confirmation." },
        { status: 409 }
      );
    }

    const { data: job } = await supabase
      .from("agent_jobs")
      .select("id, status, payload")
      .eq("workspace_id", workspace.id)
      .eq("idempotency_key", `publish-${workspace.id}-${id}`)
      .eq("status", "needs_reconciliation")
      .maybeSingle();

    const knownUrn =
      typeof (job?.payload as any)?.linkedin_post_urn === "string"
        ? ((job!.payload as any).linkedin_post_urn as string)
        : null;

    const patch =
      body.outcome === "published"
        ? {
            status: "published",
            published_at: new Date().toISOString(),
            ...(knownUrn ? { linkedin_post_id: knownUrn } : {}),
          }
        : { status: "approved", scheduled_at: null };

    const { data: updated, error: updErr } = await supabase
      .from("content_posts")
      .update(patch)
      .eq("id", id)
      .eq("workspace_id", workspace.id)
      .eq("status", "needs_reconciliation")
      .select("id, status");

    if (updErr || !updated || updated.length === 0) {
      throw new Error("Could not record the confirmation. Please try again.");
    }

    if (job) {
      await transitionJob(
        supabase,
        job.id,
        "needs_reconciliation",
        body.outcome === "published" ? "succeeded" : "canceled",
        {
          finished_at: new Date().toISOString(),
          last_error_code: null,
          safe_error_message: "Resolved by the customer.",
        }
      );
    }

    await logAuditEvent({
      workspaceId: workspace.id,
      actorType: "user",
      actorId: workspace.owner_user_id,
      action: "publish_reconciled",
      resourceType: "content_post",
      resourceId: id,
      safeMetadata: { outcome: body.outcome, jobId: job?.id ?? null },
    });

    return ok({ id, status: updated[0].status });
  } catch (err) {
    return apiError(err);
  }
}
