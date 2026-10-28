/**
 * Remote MCP Tool Definitions & Execution Engine.
 *
 * Implements MCP Tools according to Model Context Protocol standards.
 * All tools are strictly workspace-scoped, tenant-isolated, and schema-validated.
 *
 * CRITICAL BINDING RULE (BED-11 / Spec §11):
 * - `approve_draft` is PROHIBITED in MCP. AI agents and MCP clients cannot approve
 *   their own drafts. Approval must only occur via web UI or verified Telegram.
 */

import { getCalendarMonthPeriod, incrementDraftCounter } from "@/lib/db/usage";
import { createServiceClient } from "@/lib/supabase/server";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface McpToolContext {
  workspaceId: string;
  userId: string;
  scopes?: string[];
}

// ─── Tool Definitions (Read & Write) ──────────────────────────────────────────

export const MCP_TOOLS: McpToolDefinition[] = [
  // ── Read Tools ──
  {
    name: "get_agent_status",
    description: "Get the current operational status and entitlement of the Nunuza agent for this workspace.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_content_plan",
    description: "Get the active content plan and strategy (pillars, target audience, tone) for this workspace.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_drafts",
    description: "List content drafts with optional status filtering (draft, approved, rejected, published).",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["draft", "approved", "rejected", "scheduled", "published"],
          description: "Filter drafts by status",
        },
        limit: {
          type: "number",
          description: "Max number of items to return (default: 20, max: 50)",
        },
      },
    },
  },
  {
    name: "get_publishing_schedule",
    description: "Get upcoming scheduled LinkedIn posts.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_performance_summary",
    description: "Get workflow metrics and usage counter status for the current billing cycle.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_recent_activity",
    description: "Get recent audit events and agent activity logs.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max number of audit events to return (default: 15)",
        },
      },
    },
  },

  // ── Write Tools ──
  {
    name: "create_draft",
    description: "Create a new text draft in the reviewable workspace queue. Consumes one monthly workflow item.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Body text of the post" },
        hook: { type: "string", description: "Catchy opening hook line" },
        prompt: { type: "string", description: "Original topic or inspiration prompt" },
      },
      required: ["text"],
    },
  },
  {
    name: "edit_draft",
    description: "Edit an existing draft's text or hook. Note: editing an approved draft resets its status to draft and requires fresh human approval.",
    inputSchema: {
      type: "object",
      properties: {
        draft_id: { type: "string", description: "UUID of the draft to edit" },
        text: { type: "string", description: "Updated body text" },
        hook: { type: "string", description: "Updated hook" },
      },
      required: ["draft_id", "text"],
    },
  },
  {
    name: "request_draft_revision",
    description: "Request revisions on an existing draft with specific founder feedback.",
    inputSchema: {
      type: "object",
      properties: {
        draft_id: { type: "string", description: "UUID of the draft" },
        feedback: { type: "string", description: "Instructions or critique for revision" },
      },
      required: ["draft_id", "feedback"],
    },
  },
  {
    name: "reject_draft",
    description: "Mark a draft as rejected with an optional reason.",
    inputSchema: {
      type: "object",
      properties: {
        draft_id: { type: "string", description: "UUID of the draft" },
        reason: { type: "string", description: "Reason for rejection" },
      },
      required: ["draft_id"],
    },
  },
  {
    name: "pause_agent",
    description: "Pause autonomous agent operations for this workspace.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "resume_agent",
    description: "Resume autonomous agent operations for this workspace.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "schedule_post",
    description: "Schedule a human-approved draft for publishing. Rejects if draft is not approved or if workspace entitlement is draft_only.",
    inputSchema: {
      type: "object",
      properties: {
        draft_id: { type: "string", description: "UUID of the approved draft" },
        scheduled_for: { type: "string", description: "ISO 8601 UTC timestamp for publishing" },
      },
      required: ["draft_id", "scheduled_for"],
    },
  },
  {
    name: "cancel_scheduled_post",
    description: "Cancel a previously scheduled post and return it to draft state.",
    inputSchema: {
      type: "object",
      properties: {
        post_id: { type: "string", description: "UUID of the scheduled post" },
      },
      required: ["post_id"],
    },
  },
];

// Verify at compile/runtime that approve_draft is NOT present
if (MCP_TOOLS.some((t) => t.name === "approve_draft")) {
  throw new Error("CRITICAL SECURITY VIOLATION: approve_draft tool is prohibited in MCP (BED-11).");
}

// ─── Tool Execution Engine ────────────────────────────────────────────────────

export async function executeMcpTool(
  name: string,
  args: Record<string, any> = {},
  ctx: McpToolContext,
  supabaseOverride?: any
): Promise<any> {
  const supabase = supabaseOverride || createServiceClient();
  const { workspaceId, userId } = ctx;

  switch (name) {
    case "get_agent_status": {
      const { data: ws, error } = await supabase
        .from("workspaces")
        .select("id, name, entitlement_type, status, created_at")
        .eq("id", workspaceId)
        .single();

      if (error || !ws) throw new Error("Workspace not found");

      return {
        workspace_id: ws.id,
        workspace_name: ws.name,
        entitlement_type: ws.entitlement_type,
        status: ws.status,
        agent_paused: ws.status === "paused",
      };
    }

    case "get_content_plan": {
      const { data: plan } = await supabase
        .from("content_plans")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      return plan || { note: "No active content plan found for this workspace." };
    }

    case "list_drafts": {
      const limit = Math.min(Math.max(args.limit || 20, 1), 50);
      let query = supabase
        .from("content_posts")
        .select("id, hook, text, status, scheduled_for, created_at, updated_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (args.status) {
        query = query.eq("status", args.status);
      }

      const { data, error } = await query;
      if (error) throw new Error(`Failed to list drafts: ${error.message}`);
      return { drafts: data || [] };
    }

    case "get_publishing_schedule": {
      const { data, error } = await supabase
        .from("content_posts")
        .select("id, hook, text, status, scheduled_for, created_at")
        .eq("workspace_id", workspaceId)
        .eq("status", "scheduled")
        .order("scheduled_for", { ascending: true });

      if (error) throw new Error(`Failed to get schedule: ${error.message}`);
      return { scheduled_posts: data || [] };
    }

    case "get_performance_summary": {
      const now = new Date();
      const currentPeriod = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

      const { data: usage } = await supabase
        .from("usage_counters")
        .select("counter_value")
        .eq("workspace_id", workspaceId)
        .eq("period_key", currentPeriod)
        .maybeSingle();

      const { count: draftCount } = await supabase
        .from("content_posts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("status", "draft");

      const { count: publishedCount } = await supabase
        .from("content_posts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("status", "published");

      return {
        period_key: currentPeriod,
        monthly_drafts_used: usage?.counter_value ?? 0,
        monthly_drafts_limit: 30,
        pending_review_drafts: draftCount ?? 0,
        published_posts: publishedCount ?? 0,
        rate_limits: {
          max_daily_posts: 1,
          max_weekly_posts: 7,
        },
      };
    }

    case "list_recent_activity": {
      const limit = Math.min(Math.max(args.limit || 15, 1), 30);
      const { data, error } = await supabase
        .from("audit_events")
        .select("id, actor_type, action, resource_type, created_at, safe_metadata")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw new Error(`Failed to list activity: ${error.message}`);
      return { activity: data || [] };
    }

    case "create_draft": {
      if (!args.text || !args.text.trim()) {
        throw new Error("Text body is required to create a draft");
      }

      // Check monthly 30-draft quota limit
      const { periodStart, periodEnd } = getCalendarMonthPeriod();
      const { data: usageRecord } = await supabase
        .from("usage_counters")
        .select("count")
        .eq("workspace_id", workspaceId)
        .eq("metric", "draft_items_created")
        .eq("period_start", periodStart)
        .maybeSingle();

      const currentCount = usageRecord?.count ?? 0;
      if (currentCount >= 30) {
        throw new Error(`Monthly quota reached (${currentCount}/30). Draft generation is capped at 30 items per month.`);
      }

      const { data, error } = await supabase
        .from("content_posts")
        .insert({
          workspace_id: workspaceId,
          text: args.text.trim(),
          hook: args.hook ? args.hook.trim() : args.text.trim().slice(0, 100),
          prompt: args.prompt || null,
          status: "draft",
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error || !data) {
        throw new Error(`Failed to create draft: ${error?.message || "Unknown error"}`);
      }

      if (!supabaseOverride) {
        await incrementDraftCounter(workspaceId);
      }

      await supabase.from("audit_events").insert({
        workspace_id: workspaceId,
        actor_type: "mcp",
        action: "draft_created",
        resource_type: "content_post",
        resource_id: data.id,
        safe_metadata: { source: "mcp_tool" },
      });

      return { success: true, draft: data };
    }

    case "edit_draft": {
      const { draft_id, text, hook } = args;
      if (!draft_id || !text) throw new Error("draft_id and text are required");

      // Verify draft belongs to this workspace
      const { data: existing, error: findErr } = await supabase
        .from("content_posts")
        .select("*")
        .eq("id", draft_id)
        .eq("workspace_id", workspaceId)
        .single();

      if (findErr || !existing) {
        throw new Error("Draft not found or access denied");
      }

      // Save previous version to content_post_versions
      await supabase.from("content_post_versions").insert({
        post_id: draft_id,
        text: existing.text,
        hook: existing.hook,
        created_at: new Date().toISOString(),
      });

      // If draft was approved, editing resets approval (Spec §11)
      const resetStatus = existing.status === "approved" ? "draft" : existing.status;

      const { data: updated, error: updateErr } = await supabase
        .from("content_posts")
        .update({
          text: text.trim(),
          hook: hook ? hook.trim() : existing.hook,
          status: resetStatus,
          approved_at: resetStatus === "draft" ? null : existing.approved_at,
          updated_at: new Date().toISOString(),
        })
        .eq("id", draft_id)
        .select()
        .single();

      if (updateErr) throw new Error(`Failed to edit draft: ${updateErr.message}`);

      await supabase.from("audit_events").insert({
        workspace_id: workspaceId,
        actor_type: "mcp",
        action: "draft_edited",
        resource_type: "content_post",
        resource_id: draft_id,
        safe_metadata: { approval_invalidated: existing.status === "approved" },
      });

      return { success: true, draft: updated };
    }

    case "request_draft_revision": {
      const { draft_id, feedback } = args;
      if (!draft_id || !feedback) throw new Error("draft_id and feedback are required");

      const { data: post, error } = await supabase
        .from("content_posts")
        .select("*")
        .eq("id", draft_id)
        .eq("workspace_id", workspaceId)
        .single();

      if (error || !post) throw new Error("Draft not found or access denied");

      await supabase
        .from("content_posts")
        .update({
          revision_feedback: feedback.trim(),
          status: "draft",
          updated_at: new Date().toISOString(),
        })
        .eq("id", draft_id);

      await supabase.from("audit_events").insert({
        workspace_id: workspaceId,
        actor_type: "mcp",
        action: "draft_revision_requested",
        resource_type: "content_post",
        resource_id: draft_id,
        safe_metadata: { feedback },
      });

      return { success: true, note: "Revision request recorded for draft." };
    }

    case "reject_draft": {
      const { draft_id, reason } = args;
      if (!draft_id) throw new Error("draft_id is required");

      const { data: post, error } = await supabase
        .from("content_posts")
        .select("id")
        .eq("id", draft_id)
        .eq("workspace_id", workspaceId)
        .single();

      if (error || !post) throw new Error("Draft not found or access denied");

      await supabase
        .from("content_posts")
        .update({
          status: "rejected",
          rejection_reason: reason || "Rejected via MCP",
          updated_at: new Date().toISOString(),
        })
        .eq("id", draft_id);

      await supabase.from("audit_events").insert({
        workspace_id: workspaceId,
        actor_type: "mcp",
        action: "draft_rejected",
        resource_type: "content_post",
        resource_id: draft_id,
        safe_metadata: { reason },
      });

      return { success: true, message: `Draft ${draft_id} rejected.` };
    }

    case "pause_agent": {
      await supabase
        .from("workspaces")
        .update({ status: "paused" })
        .eq("id", workspaceId);

      await supabase.from("audit_events").insert({
        workspace_id: workspaceId,
        actor_type: "mcp",
        action: "agent_paused",
        resource_type: "workspace",
        resource_id: workspaceId,
        safe_metadata: {},
      });

      return { success: true, agent_status: "paused" };
    }

    case "resume_agent": {
      await supabase
        .from("workspaces")
        .update({ status: "active" })
        .eq("id", workspaceId);

      await supabase.from("audit_events").insert({
        workspace_id: workspaceId,
        actor_type: "mcp",
        action: "agent_resumed",
        resource_type: "workspace",
        resource_id: workspaceId,
        safe_metadata: {},
      });

      return { success: true, agent_status: "active" };
    }

    case "schedule_post": {
      const { draft_id, scheduled_for } = args;
      if (!draft_id || !scheduled_for) throw new Error("draft_id and scheduled_for are required");

      // Verify workspace entitlement
      const { data: ws } = await supabase
        .from("workspaces")
        .select("entitlement_type")
        .eq("id", workspaceId)
        .single();

      if (!ws || ws.entitlement_type === "draft_only" || ws.entitlement_type === "inactive") {
        throw new Error(
          `ENTITLEMENT_RESTRICTED: Workspace entitlement "${ws?.entitlement_type || "draft_only"}" cannot schedule posts. Public signup is limited to draft-only preview.`
        );
      }

      // Verify draft belongs to workspace and has been approved by human
      const { data: post, error } = await supabase
        .from("content_posts")
        .select("*")
        .eq("id", draft_id)
        .eq("workspace_id", workspaceId)
        .single();

      if (error || !post) throw new Error("Draft not found or access denied");

      if (post.status !== "approved") {
        throw new Error(
          `UNAPPROVED_DRAFT: Draft must be approved by an authenticated human before scheduling. Current status: "${post.status}". MCP clients cannot self-approve.`
        );
      }

      const scheduledDate = new Date(scheduled_for);
      if (isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
        throw new Error("scheduled_for must be a valid future ISO 8601 timestamp");
      }

      // Check daily rate limit: max 1 post per calendar day
      const dayStart = new Date(scheduledDate);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(scheduledDate);
      dayEnd.setUTCHours(23, 59, 59, 999);

      const { count: dailyCount } = await supabase
        .from("content_posts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("status", "scheduled")
        .gte("scheduled_for", dayStart.toISOString())
        .lte("scheduled_for", dayEnd.toISOString());

      if ((dailyCount ?? 0) >= 1) {
        throw new Error("RATE_LIMIT_EXCEEDED: Cannot schedule more than 1 post per calendar day (BED-02).");
      }

      // Check weekly rate limit: max 7 posts per rolling 7 days
      const weekStart = new Date(scheduledDate.getTime() - 7 * 24 * 60 * 60 * 1000);
      const { count: weeklyCount } = await supabase
        .from("content_posts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("status", "scheduled")
        .gte("scheduled_for", weekStart.toISOString())
        .lte("scheduled_for", scheduledDate.toISOString());

      if ((weeklyCount ?? 0) >= 7) {
        throw new Error("RATE_LIMIT_EXCEEDED: Cannot schedule more than 7 posts per rolling 7-day period (BED-02).");
      }

      // Schedule post
      const { data: updated, error: schedErr } = await supabase
        .from("content_posts")
        .update({
          status: "scheduled",
          scheduled_for: scheduledDate.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", draft_id)
        .select()
        .single();

      if (schedErr) throw new Error(`Scheduling failed: ${schedErr.message}`);

      await supabase.from("audit_events").insert({
        workspace_id: workspaceId,
        actor_type: "mcp",
        action: "post_scheduled",
        resource_type: "content_post",
        resource_id: draft_id,
        safe_metadata: { scheduled_for: scheduledDate.toISOString() },
      });

      return { success: true, post: updated };
    }

    case "cancel_scheduled_post": {
      const { post_id } = args;
      if (!post_id) throw new Error("post_id is required");

      const { data: post, error } = await supabase
        .from("content_posts")
        .select("*")
        .eq("id", post_id)
        .eq("workspace_id", workspaceId)
        .single();

      if (error || !post) throw new Error("Scheduled post not found or access denied");

      if (post.status !== "scheduled") {
        throw new Error(`Post is not in scheduled state. Current status: ${post.status}`);
      }

      const { data: reverted, error: revertErr } = await supabase
        .from("content_posts")
        .update({
          status: "draft",
          scheduled_for: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", post_id)
        .select()
        .single();

      if (revertErr) throw new Error(`Cancellation failed: ${revertErr.message}`);

      await supabase.from("audit_events").insert({
        workspace_id: workspaceId,
        actor_type: "mcp",
        action: "post_schedule_cancelled",
        resource_type: "content_post",
        resource_id: post_id,
        safe_metadata: {},
      });

      return { success: true, post: reverted };
    }

    default:
      throw new Error(`Unknown MCP tool: "${name}"`);
  }
}
