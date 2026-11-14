/**
 * POST /api/posts — create a new draft post
 * GET  /api/posts — list posts for the authenticated workspace
 *
 * Authorization: requireWorkspace() — session-derived workspace, never client-supplied.
 * RLS provides a second layer of defense at the DB level.
 *
 * draft_only workspaces: may create/read drafts only (status: draft | needs_review | rejected)
 * publishing-enabled workspaces: additionally allowed to approve/schedule/publish via PATCH /api/posts/[id]
 */

import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { createClient } from "@/lib/supabase/server";
import { ok, created, apiError, parseBody, requireFields } from "@/lib/api/respond";
import type { PostStatus } from "@/types/database";
import { checkDraftLimit, reserveDraftUsage, createDraftWithUsage, releaseDraftUsage } from "@/lib/db/usage";

// Statuses that draft_only workspaces may filter by (read)
const DRAFT_READABLE_STATUSES: PostStatus[] = [
  "draft",
  "needs_review",
  "approved",
  "rejected",
  "canceled",
];

// Statuses that may be set when creating a new post via API
const CREATABLE_STATUSES: PostStatus[] = ["draft", "needs_review"];

export async function GET(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const supabase = await createClient();

    const url = new URL(request.url);
    const status = url.searchParams.get("status") as PostStatus | null;
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 100);
    const offset = Number(url.searchParams.get("offset") ?? "0");

    let query = supabase
      .from("content_posts")
      .select("*")
      .eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) throw error;

    return ok(data ?? []);
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request) {
  let reservationId: string | null = null;
  let reservationWorkspaceId: string | null = null;
  let reservationOwnerId: string | null = null;
  try {
    const workspace = await requireWorkspace();

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

    const missing = requireFields(body as Record<string, unknown>, ["text"]);
    if (missing) {
      return NextResponse.json({ error: missing }, { status: 400 });
    }

    if (typeof body.text !== "string" || body.text.trim().length === 0 || body.text.length > 3000) {
      return NextResponse.json({ error: "Post text must contain 1 to 3000 characters." }, { status: 400 });
    }

    // Clamp status to allowed values. A client cannot create approved/scheduled posts.
    const status: PostStatus =
      body.status && CREATABLE_STATUSES.includes(body.status)
        ? body.status
        : "draft";

    const effectiveStatus: PostStatus =
      workspace.entitlement_type === "draft_only" &&
      !DRAFT_READABLE_STATUSES.includes(status)
        ? "draft"
        : status;

    // Manual drafts consume the same monthly allowance as AI-created drafts.
    const reservation = await reserveDraftUsage(workspace.id, workspace.owner_user_id);
    if (!reservation) {
      const usage = await checkDraftLimit(workspace.id, workspace.owner_user_id);
      return NextResponse.json(
        {
          error: `Monthly limit reached (${usage.count}/${usage.limit} items). Resets on ${usage.resetsOn}.`,
          code: "USAGE_LIMIT_EXCEEDED",
        },
        { status: 429 }
      );
    }

    reservationId = reservation.reservationId;
    reservationWorkspaceId = workspace.id;
    reservationOwnerId = workspace.owner_user_id;

    const data = await createDraftWithUsage(
      reservationId,
      workspace.id,
      workspace.owner_user_id,
      {
        text: body.text.trim(),
        internal_title: body.internal_title ?? null,
        pillar: body.pillar ?? null,
        source_notes: body.source_notes ?? null,
      },
      effectiveStatus as "draft" | "needs_review"
    );
    reservationId = null;

    return created(data);
  } catch (err) {
    return apiError(err);
  } finally {
    if (reservationId && reservationWorkspaceId && reservationOwnerId) {
      try {
        await releaseDraftUsage(reservationId, reservationWorkspaceId, reservationOwnerId);
      } catch (releaseError) {
        console.error("[usage] Failed to release manual draft reservation:", releaseError);
      }
    }
  }
}
