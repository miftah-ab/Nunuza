/**
 * Workspace-scoped data access for content posts.
 *
 * All functions accept a pre-verified workspace_id — callers MUST have
 * already called requireWorkspace() or requireWorkspaceAccess() before
 * invoking these. Never pass user-supplied IDs directly.
 *
 * These functions use the anon Supabase client (subject to RLS).
 * The DB-level RLS policies provide the second tenant-isolation layer.
 */

import { createClient } from "@/lib/supabase/server";
import type {
  ContentPost,
  PostStatus,
  Database,
} from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ListPostsOptions {
  status?: PostStatus | PostStatus[];
  limit?: number;
  offset?: number;
  orderBy?: "created_at" | "updated_at" | "scheduled_at";
  orderDir?: "asc" | "desc";
}

export interface CreatePostInput {
  text: string;
  internal_title?: string;
  pillar?: string;
  source_notes?: string;
  plan_id?: string;
}

export interface UpdatePostInput {
  text?: string;
  internal_title?: string;
  pillar?: string;
  source_notes?: string;
  status?: PostStatus;
  scheduled_at?: string | null;
}

// ─── Post queries ─────────────────────────────────────────────────────────────

/**
 * List posts for a workspace with optional filters.
 * workspace_id must be pre-verified (from requireWorkspace).
 */
export async function listPosts(
  workspaceId: string,
  options: ListPostsOptions = {}
): Promise<ContentPost[]> {
  const supabase = await createClient();
  const {
    status,
    limit = 50,
    offset = 0,
    orderBy = "updated_at",
    orderDir = "desc",
  } = options;

  let query = supabase
    .from("content_posts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order(orderBy, { ascending: orderDir === "asc" })
    .range(offset, offset + limit - 1);

  if (status) {
    const statuses = Array.isArray(status) ? status : [status];
    query = query.in("status", statuses);
  }

  const { data, error } = await query;
  if (error) throw new Error(`[db] listPosts: ${error.message}`);
  return (data ?? []) as ContentPost[];
}

/**
 * Fetch a single post by ID.
 * Verifies workspace ownership via the workspaceId parameter + RLS.
 */
export async function getPost(
  workspaceId: string,
  postId: string
): Promise<ContentPost | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("content_posts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", postId)
    .single();

  if (error?.code === "PGRST116") return null; // not found
  if (error) throw new Error(`[db] getPost: ${error.message}`);
  return data as ContentPost;
}

/**
 * Create a new draft post.
 * Enforces workspace scoping — workspaceId is from the verified session, never client input.
 */
export async function createPost(
  workspaceId: string,
  userId: string,
  input: CreatePostInput
): Promise<ContentPost> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("content_posts")
    .insert({
      workspace_id: workspaceId,
      created_by: userId,
      text: input.text,
      internal_title: input.internal_title ?? null,
      pillar: input.pillar ?? null,
      source_notes: input.source_notes ?? null,
      plan_id: input.plan_id ?? null,
      status: "draft",
      version: 1,
    })
    .select()
    .single();

  if (error) throw new Error(`[db] createPost: ${error.message}`);

  // Append the initial version record
  await appendPostVersion(supabase, workspaceId, data.id, 1, input.text, "user_edit", userId);

  return data as ContentPost;
}

/**
 * Update a post's editable fields.
 * On text change, appends a new version record.
 */
export async function updatePost(
  workspaceId: string,
  postId: string,
  userId: string,
  input: UpdatePostInput
): Promise<ContentPost> {
  const supabase = await createClient();

  // Fetch current version for version increment
  const current = await getPost(workspaceId, postId);
  if (!current) throw new Error(`[db] updatePost: post ${postId} not found`);

  const newVersion = input.text !== undefined && input.text !== current.text
    ? current.version + 1
    : current.version;

  const { data, error } = await supabase
    .from("content_posts")
    .update({
      ...(input.text !== undefined && { text: input.text, version: newVersion }),
      ...(input.internal_title !== undefined && { internal_title: input.internal_title }),
      ...(input.pillar !== undefined && { pillar: input.pillar }),
      ...(input.source_notes !== undefined && { source_notes: input.source_notes }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.scheduled_at !== undefined && { scheduled_at: input.scheduled_at }),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", postId)
    .select()
    .single();

  if (error) throw new Error(`[db] updatePost: ${error.message}`);

  // Append version if text changed
  if (input.text !== undefined && input.text !== current.text) {
    await appendPostVersion(supabase, workspaceId, postId, newVersion, input.text, "user_edit", userId);
  }

  return data as ContentPost;
}

/**
 * Count posts in a given status for a workspace.
 * Used for usage limit checks and dashboard counters.
 */
export async function countPosts(
  workspaceId: string,
  status?: PostStatus
): Promise<number> {
  const supabase = await createClient();

  let query = supabase
    .from("content_posts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);

  if (status) query = query.eq("status", status);

  const { count, error } = await query;
  if (error) throw new Error(`[db] countPosts: ${error.message}`);
  return count ?? 0;
}

// ─── Version helpers ──────────────────────────────────────────────────────────

async function appendPostVersion(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  postId: string,
  versionNumber: number,
  text: string,
  changeSource: "user_edit" | "ai_revision" | "import",
  changedBy: string
) {
  const { error } = await supabase.from("content_post_versions").insert({
    workspace_id: workspaceId,
    post_id: postId,
    version_number: versionNumber,
    text,
    change_source: changeSource,
    changed_by: changedBy,
  });

  if (error) {
    // Log but don't throw — version append failure should not block the main operation
    console.error(`[db] appendPostVersion: ${error.message}`);
  }
}
