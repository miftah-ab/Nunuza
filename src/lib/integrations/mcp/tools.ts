/**
 * Remote MCP Tool Definitions & Execution Engine.
 *
 * Implements MCP Tools according to Model Context Protocol standards.
 * All tools are strictly workspace-scoped, tenant-isolated, and schema-validated.
 *
 * MCP approval is available only for explicit owner-directed actions. Claude must
 * never approve autonomously; configure approve_draft as "Needs approval" in
 * Claude Manual mode. Approval changes review status only; scheduling is separate.
 */

import { getCalendarMonthPeriod, incrementDraftCounter } from "@/lib/db/usage";
import { createServiceClient } from "@/lib/supabase/server";
import { notifyWorkspaceTelegram } from "@/lib/integrations/telegram/service";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
    additionalProperties?: boolean;
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
    name: "approve_draft",
    description: "Approve a specific draft only after the workspace owner explicitly instructs you in the current conversation. Never approve a draft autonomously or merely because Nunuza generated it. In Claude Manual mode, configure this tool as Needs approval. Approval changes the draft status only; it does not schedule or publish the post.",
    inputSchema: {
      type: "object",
      properties: {
        draft_id: { type: "string", description: "UUID of the exact draft the owner explicitly approved" },
      },
      required: ["draft_id"],
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

const READ_MCP_TOOL_NAMES = new Set([
  "get_agent_status", "get_content_plan", "list_drafts",
  "get_publishing_schedule", "get_performance_summary", "list_recent_activity",
]);

/** Return only the tools allowed by a credential’s explicit scopes. */
export function getMcpToolsForScopes(scopes: string[] = []): McpToolDefinition[] {
  const allowed = new Set(scopes);
  return MCP_TOOLS.filter((tool) => READ_MCP_TOOL_NAMES.has(tool.name) ? allowed.has("read") : allowed.has("write"));
}

/** Reject malformed arguments instead of silently ignoring unknown or mistyped fields. */
export function validateMcpToolArguments(name: string, args: unknown): asserts args is Record<string, any> {
  const tool = MCP_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Unknown MCP tool: ${name}`);
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Tool arguments must be a JSON object.");
  const values = args as Record<string, unknown>;
  const properties = tool.inputSchema.properties;
  for (const key of Object.keys(values)) {
    if (!(key in properties)) throw new Error(`Unexpected argument: ${key}`);
    const definition = properties[key];
    const value = values[key];
    if (definition.type === "string" && typeof value !== "string") throw new Error(`Argument "${key}" must be a string.`);
    if (definition.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) throw new Error(`Argument "${key}" must be a finite number.`);
    if (definition.enum && !definition.enum.includes(value)) throw new Error(`Argument "${key}" has an unsupported value.`);
  }
  for (const key of tool.inputSchema.required || []) {
    if (values[key] === undefined || values[key] === null || values[key] === "") throw new Error(`Missing required argument: ${key}`);
  }
}

// ─── Tool Execution Engine ────────────────────────────────────────────────────

export async function executeMcpTool(
  name: string,
  args: Record<string, any> = {},
  ctx: McpToolContext,
  supabaseOverride?: any
): Promise<any> {
  const allowedScopes = new Set(ctx.scopes ?? ["read", "write"]);
  const isReadTool = READ_MCP_TOOL_NAMES.has(name);
  const knownTool = MCP_TOOLS.some((tool) => tool.name === name);
  if (!knownTool) throw new Error(`Unknown MCP tool: ${name}`);
  if (isReadTool && !allowedScopes.has("read")) throw new Error("This MCP credential does not have the read scope.");
  if (!isReadTool && !allowedScopes.has("write")) throw new Error("This MCP credential does not have the write scope.");
  validateMcpToolArguments(name, args);

  const supabase = supabaseOverride || createServiceClient();
  const { workspaceId, userId } = ctx;

  switch (name) {
    case "get_agent_status": {
      const { data: ws, error } = await supabase
        .from("workspaces")
        .select("id, name, entitlement_type, state, paused_at, created_at")
        .eq("id", workspaceId)
        .single();

      if (error || !ws) throw new Error("Workspace not found");

      return {
        workspace_id: ws.id,
        workspace_name: ws.name,
        entitlement_type: ws.entitlement_type,
        state: ws.state,
        agent_paused: ws.state === "paused",
      };
    }

    case "get_content_plan": {
      // The agent's operational strategy is stored in content_strategies.
      // content_plans is a separate generated-calendar table and may be empty
      // even when onboarding strategy is configured.
      const [{ data: strategy, error: strategyError }, { data: voice, error: voiceError }] =
        await Promise.all([
          supabase.from("content_strategies").select("*").eq("workspace_id", workspaceId).maybeSingle(),
          supabase.from("voice_profiles").select("*").eq("workspace_id", workspaceId).maybeSingle(),
        ]);

      if (strategyError || voiceError) {
        throw new Error("Could not load the workspace content strategy.");
      }

      if (!strategy) {
        return {
          configured: false,
          note: "No content strategy is configured yet. Use the workspace's existing profile and content history where available; ask the owner to complete strategy setup only when essential context is genuinely missing.",
          voice_profile_configured: Boolean(voice),
          voice_profile: voice,
        };
      }

      return {
        configured: true,
        strategy,
        voice_profile: voice,
      };
    }

    case "list_drafts": {
      const limit = Math.min(Math.max(args.limit || 20, 1), 50);
      let query = supabase
        .from("content_posts")
        .select("id, internal_title, text, status, scheduled_at, created_at, updated_at")
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
        .select("id, internal_title, text, status, scheduled_at, created_at")
        .eq("workspace_id", workspaceId)
        .eq("status", "scheduled")
        .order("scheduled_at", { ascending: true });

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
          internal_title: args.hook ? args.hook.trim() : null,
          status: "draft",
          version: 1,
          created_by: userId,
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

      // MCP-created drafts bypass the dashboard generation route, so send the
      // same proactive Telegram update here instead of silently leaving the
      // connected user unaware. Notification failure must not undo a saved draft.
      const escapeMarkdownV2 = (value: string) =>
        value.replace(/([_\*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://nunuza-xi.vercel.app";
      const snippet = (data.text || "").slice(0, 500).replace(/\s+/g, " ").trim();
      const delivery = await notifyWorkspaceTelegram(workspaceId, {
        text:
          "🔔 *New draft saved in Nunuza*\n\n" +
          "*" + escapeMarkdownV2(data.internal_title || "LinkedIn draft") + "*\n\n" +
          escapeMarkdownV2(snippet) +
          "\n\nOpen Nunuza to review and approve it.",
        replyMarkup: {
          inline_keyboard: [[{ text: "📝 Review draft", url: appUrl + "/app/content?post=" + data.id }]],
        },
      }, supabase);
      const telegramNotification = delivery.ok ? "sent" : "not_sent";
      if (!delivery.ok) {
        console.warn("[mcp] Draft saved, but Telegram notification was not delivered.");
      }

      return { success: true, draft: data, telegram_notification: telegramNotification };
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
      const { error: versionErr } = await supabase.from("content_post_versions").insert({
        workspace_id: workspaceId,
        post_id: draft_id,
        version_number: existing.version,
        text: existing.text,
        change_source: "ai_revision",
        changed_by: userId,
      });
      if (versionErr) console.error(`[mcp] edit_draft version snapshot failed: ${versionErr.message}`);

      // If draft was approved, editing resets approval (Spec §11)
      const resetStatus = existing.status === "approved" ? "draft" : existing.status;

      const { data: updated, error: updateErr } = await supabase
        .from("content_posts")
        .update({
          text: text.trim(),
          internal_title: hook ? hook.trim() : existing.internal_title,
          status: resetStatus,
          version: existing.version + 1,
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

    case "approve_draft": {
      const { draft_id } = args;
      if (!draft_id) throw new Error("draft_id is required");

      const { data: workspace, error: workspaceError } = await supabase
        .from("workspaces").select("entitlement_type").eq("id", workspaceId).single();
      if (workspaceError || !workspace) throw new Error("Workspace not found");

      const canApprove = ["internal_beta", "publishing_beta", "paid_trial", "paid_active"].includes(workspace.entitlement_type);
      if (!canApprove) throw new Error("ENTITLEMENT_RESTRICTED: This workspace does not have approval and publishing access.");

      const { data: post, error: findError } = await supabase
        .from("content_posts").select("*").eq("id", draft_id).eq("workspace_id", workspaceId).single();
      if (findError || !post) throw new Error("Draft not found or access denied");
      if (post.status !== "draft" && post.status !== "needs_review") {
        throw new Error(`Only drafts awaiting review can be approved. Current status: "${post.status}".`);
      }

      const { data: approved, error: approveError } = await supabase
        .from("content_posts")
        .update({ status: "approved", updated_at: new Date().toISOString() })
        .eq("id", draft_id).eq("workspace_id", workspaceId).select().single();
      if (approveError || !approved) throw new Error("Could not approve this draft. Refresh its status and try again.");

      const { error: signalError } = await supabase.from("approval_events").insert({
        workspace_id: workspaceId, post_id: draft_id, actor_type: "user", actor_id: userId,
        action: "approved", reason: "Explicit owner approval through Claude MCP",
      });
      if (signalError) console.error("[mcp] Approval learning signal failed:", signalError.message);

      const { error: auditError } = await supabase.from("audit_events").insert({
        workspace_id: workspaceId, actor_type: "mcp", action: "draft_approved",
        resource_type: "content_post", resource_id: draft_id,
        safe_metadata: { approval_channel: "mcp", explicit_owner_instruction_required: true },
      });
      if (auditError) console.error("[mcp] Draft approval audit event failed:", auditError.message);

      return {
        success: true, message: "Draft approved. It is not scheduled or published.",
        draft: approved, next_step: "Schedule only if the workspace owner explicitly requests it.",
      };
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
        .update({ paused_at: new Date().toISOString(), state: "paused" })
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
      const { data: wsRow } = await supabase
        .from("workspaces")
        .select("operating_mode")
        .eq("id", workspaceId)
        .single();

      await supabase
        .from("workspaces")
        .update({
          paused_at: null,
          state: wsRow?.operating_mode === "autopilot" ? "active_autopilot" : "active_approval_required",
        })
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
        .select("entitlement_type, paused_at")
        .eq("id", workspaceId)
        .single();

      if (ws?.paused_at) {
        throw new Error("Agent is paused. Resume before scheduling posts.");
      }

      const canScheduleEntitlement =
        ws &&
        (ws.entitlement_type === "internal_beta" ||
          ws.entitlement_type === "publishing_beta" ||
          ws.entitlement_type === "paid_trial" ||
          ws.entitlement_type === "paid_active");

      if (!canScheduleEntitlement) {
        throw new Error(
          `ENTITLEMENT_RESTRICTED: Workspace entitlement "${ws?.entitlement_type || "suspended"}" cannot schedule posts. Requires an active trial or subscription.`
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
        .gte("scheduled_at", dayStart.toISOString())
        .lte("scheduled_at", dayEnd.toISOString());

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
        .gte("scheduled_at", weekStart.toISOString())
        .lte("scheduled_at", scheduledDate.toISOString());

      if ((weeklyCount ?? 0) >= 7) {
        throw new Error("RATE_LIMIT_EXCEEDED: Cannot schedule more than 7 posts per rolling 7-day period (BED-02).");
      }

      // Enqueue the durable publish job (same shape as lib/jobs/scheduling.ts schedulePost)
      const { error: jobErr } = await supabase.from("agent_jobs").upsert(
        {
          workspace_id: workspaceId,
          job_type: "publish_post",
          status: "queued",
          idempotency_key: `publish-${workspaceId}-${draft_id}`,
          payload: {
            postId: draft_id,
            workspaceId,
            userId,
            targetProvider: "linkedin",
            scheduledFor: scheduledDate.toISOString(),
          },
          scheduled_for: scheduledDate.toISOString(),
          attempt_count: 0,
          max_attempts: 3,
          safe_error_message: null,
        },
        { onConflict: "idempotency_key" }
      );
      if (jobErr) throw new Error(`Scheduling failed: ${jobErr.message}`);

      // Schedule post
      const { data: updated, error: schedErr } = await supabase
        .from("content_posts")
        .update({
          status: "scheduled",
          scheduled_at: scheduledDate.toISOString(),
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

      // Cancel queued/retryable publish jobs (same as lib/jobs/scheduling.ts cancelScheduledPost)
      await supabase
        .from("agent_jobs")
        .update({ status: "canceled" })
        .eq("workspace_id", workspaceId)
        .eq("idempotency_key", `publish-${workspaceId}-${post_id}`)
        .in("status", ["queued", "failed_retryable", "waiting_for_approval"]);

      const { data: reverted, error: revertErr } = await supabase
        .from("content_posts")
        .update({
          status: "approved",
          scheduled_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", post_id)
        .eq("workspace_id", workspaceId)
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
