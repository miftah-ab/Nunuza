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
    }>(request);

    if (!body) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    // The UI re-sends the current status on every save; an unchanged status is not a transition.
    if (body.status === post.status) {
      delete body.status;
    }

    // Published / in-flight posts are immutable
    if (post.status === "published" || post.status === "publishing") {
      throw new ForbiddenError(
        "Published posts cannot be edited. Create a new draft."
      );
    }

    // Scheduling, publishing and cancel-of-schedule have dedicated flows
    // (/api/posts/[id]/schedule and the publishing job); PATCH never sets them.
    if (
      body.status &&
      (body.status === "scheduled" ||
        body.status === "publishing" ||
        body.status === "published")
    ) {
      throw new ForbiddenError(
        "Use the schedule endpoint to schedule a post; publishing is performed by the publishing job."
      );
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

      // Require publishing entitlement to approve
      if (
        PUBLISH_REQUIRED_STATUSES.includes(targetStatus) &&
        !canPublish(workspace)
      ) {
        throw new ForbiddenError(
          "Your workspace entitlement does not permit approving posts for publishing."
        );
      }
    }

    const textChanged = body.text !== undefined && body.text !== post.text;

    // A scheduled post has a queued publish job; its text must not change underneath it.
    if (textChanged && post.status === "scheduled") {
      throw new ForbiddenError(
        "Cancel the scheduled post before editing its text."
      );
    }

    // Editing an approved post invalidates the approval (Spec §11): back to draft
    // unless the caller explicitly sets another allowed status.
    const nextStatus: PostStatus | undefined =
      textChanged && post.status === "approved" &&
      (body.status === undefined || body.status === "approved")
        ? "draft"
        : body.status;

    const supabase = await createClient();

    // Snapshot the pre-edit text in content_post_versions (same row shape as MCP edit_draft)
    if (textChanged) {
      const { error: versionErr } = await supabase
        .from("content_post_versions")
        .insert({
          workspace_id: workspace.id,
          post_id: id,
          version_number: post.version,
          text: post.text,
          change_source: "user_edit",
          changed_by: workspace.owner_user_id,
        });
      if (versionErr) {
        console.error(`[posts] version snapshot failed: ${versionErr.message}`);
      }
    }

    const { data, error } = await supabase
      .from("content_posts")
      .update({
        ...(body.text !== undefined && { text: body.text }),
        ...(body.internal_title !== undefined && { internal_title: body.internal_title }),
        ...(body.pillar !== undefined && { pillar: body.pillar }),
        ...(body.source_notes !== undefined && { source_notes: body.source_notes }),
        ...(nextStatus !== undefined && { status: nextStatus }),
        version: post.version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("workspace_id", workspace.id)
      .select()
      .single();

    if (error) throw error;

    if (nextStatus === "approved" || nextStatus === "rejected") {
      const { error: signalError } = await supabase.from("approval_events").insert({
        workspace_id: workspace.id, post_id: id, actor_type: "user",
        actor_id: workspace.owner_user_id, action: nextStatus,
        reason: nextStatus === "rejected" ? "Rejected in dashboard" : null,
      });
      if (signalError) console.error("[posts] Approval learning signal failed:", signalError.message);
    } else if (textChanged) {
      const { error: signalError } = await supabase.from("approval_events").insert({
        workspace_id: workspace.id, post_id: id, actor_type: "user",
        actor_id: workspace.owner_user_id, action: "revised", reason: "Edited in dashboard",
      });
      if (signalError) console.error("[posts] Edit learning signal failed:", signalError.message);
    }

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
