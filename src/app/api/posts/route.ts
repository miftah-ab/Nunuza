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
  try {
    const workspace = await requireWorkspace();
    const supabase = await createClient();

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

    // Clamp status to allowed values
    const status: PostStatus =
      body.status && CREATABLE_STATUSES.includes(body.status)
        ? body.status
        : "draft";

    // Enforce draft_only gate: only draft/needs_review allowed regardless of requested status
    const effectiveStatus: PostStatus =
      workspace.entitlement_type === "draft_only" &&
      !DRAFT_READABLE_STATUSES.includes(status)
        ? "draft"
        : status;

    const { data, error } = await supabase
      .from("content_posts")
      .insert({
        workspace_id: workspace.id,
        text: body.text!,
        internal_title: body.internal_title ?? null,
        pillar: body.pillar ?? null,
        source_notes: body.source_notes ?? null,
        status: effectiveStatus,
        version: 1,
        created_by: "user",
      })
      .select()
      .single();

    if (error) throw error;

    return created(data);
  } catch (err) {
    return apiError(err);
  }
}
