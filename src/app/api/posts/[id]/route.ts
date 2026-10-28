/**
 * GET    /api/posts/[id] — get a single post
 * PATCH  /api/posts/[id] — update text, status, or other fields
 * DELETE /api/posts/[id] — soft-delete (cancel) a post
 *
 * Authorization: workspace ownership verified via requireWorkspaceAccess().
 * The post's workspace_id must match the authenticated user's workspace.
 */

import { NextResponse } from "next/server";
import {
  requireWorkspace,
  canPublish,
  ForbiddenError,
} from "@/lib/auth/workspace";
import { createClient } from "@/lib/supabase/server";
import { ok, apiError, parseBody } from "@/lib/api/respond";
import type { PostStatus } from "@/types/database";

// Statuses that draft_only workspaces may set on a post
const DRAFT_ONLY_ALLOWED_STATUSES: PostStatus[] = [
  "draft",
  "needs_review",
  "rejected",
  "canceled",
];

// Statuses that require publishing entitlement
const PUBLISH_REQUIRED_STATUSES: PostStatus[] = [
  "approved",
  "scheduled",
  "publishing",
  "published",
];

type RouteParams = { params: Promise<{ id: string }> };

async function resolvePost(id: string, workspaceId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_posts")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", workspaceId) // RLS + explicit ownership check
    .single();

  if (error || !data) {
    throw new ForbiddenError("Post not found.");
  }
  return data;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const workspace = await requireWorkspace();
    const post = await resolvePost(id, workspace.id);
    return ok(post);
  } catch (err) {
    return apiError(err);
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const workspace = await requireWorkspace();
    const post = await resolvePost(id, workspace.id);

    const body = await parseBody<{
      text?: string;
      internal_title?: string;
      pillar?: string;
      source_notes?: string;
      status?: PostStatus;
      scheduled_at?: string | null;
    }>(request);

    if (!body) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    // Validate status transition
    if (body.status) {
      const targetStatus = body.status;

      // draft_only: block statuses that imply publishing/scheduling
      if (
        workspace.entitlement_type === "draft_only" &&
        PUBLISH_REQUIRED_STATUSES.includes(targetStatus)
      ) {
        throw new ForbiddenError(
          "This workspace cannot approve or schedule posts for publishing."
        );
      }

      // Require publishing entitlement to approve/schedule
      if (
        PUBLISH_REQUIRED_STATUSES.includes(targetStatus) &&
        !canPublish(workspace)
      ) {
        throw new ForbiddenError(
          "Your workspace entitlement does not permit approving posts for publishing."
        );
      }

      // Cannot edit a post that has already been published
      if (post.status === "published" || post.status === "publishing") {
        throw new ForbiddenError(
          "Published posts cannot be edited. Create a new draft."
        );
      }
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("content_posts")
      .update({
        ...(body.text !== undefined && { text: body.text }),
        ...(body.internal_title !== undefined && { internal_title: body.internal_title }),
        ...(body.pillar !== undefined && { pillar: body.pillar }),
        ...(body.source_notes !== undefined && { source_notes: body.source_notes }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.scheduled_at !== undefined && { scheduled_at: body.scheduled_at }),
        version: post.version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("workspace_id", workspace.id)
      .select()
      .single();

    if (error) throw error;

    return ok(data);
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const workspace = await requireWorkspace();
    const post = await resolvePost(id, workspace.id);

    // Cannot cancel an in-flight publish
    if (post.status === "publishing") {
      throw new ForbiddenError(
        "A post currently being published cannot be canceled. Wait for reconciliation."
      );
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("content_posts")
      .update({ status: "canceled", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("workspace_id", workspace.id);

    if (error) throw error;

    return ok({ id, status: "canceled" });
  } catch (err) {
    return apiError(err);
  }
}
