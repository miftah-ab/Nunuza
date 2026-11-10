/**
 * Nunuza autonomous operating cycle.
 *
 * Uses the existing durable worker, workspace strategy, voice profile, content
 * posts, approval events, usage counters, audit events and Telegram delivery.
 * No parallel scheduler and no customer-supplied topic are required.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { aiService } from "@/lib/ai/service";
import { notifyWorkspaceTelegram } from "@/lib/integrations/telegram/service";
import type { AgentJob } from "@/types/database";
import type { JobExecutionResult } from "./types";

const ELIGIBLE_ENTITLEMENTS = [
  "internal_beta",
  "paid_trial",
  "paid_active",
  "publishing_beta",
  "internal_test",
] as const;
const ACTIVE_STATES = ["active_approval_required", "active_autopilot"] as const;
const MAX_FEED_ITEMS = 20;
const RESEARCH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ResearchItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
}

export interface ScoredOpportunity extends ResearchItem {
  score: number;
  matchedKeywords: string[];
  relevance: "high" | "medium" | "low";
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tagValue(xml: string, tag: string): string {
  const match = xml.match(new RegExp("<" + tag + "(?:\\\\s[^>]*)?>([\\\\s\\\\S]*?)</" + tag + ">", "i"));
  return match ? decodeXml(match[1]) : "";
}

export function parseResearchFeed(xml: string, now = Date.now()): ResearchItem[] {
  const items: ResearchItem[] = [];
  const itemPattern = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(xml)) && items.length < MAX_FEED_ITEMS) {
    const block = match[1];
    const title = tagValue(block, "title");
    const link = tagValue(block, "link");
    const pubDate = tagValue(block, "pubDate");
    const sourceMatch = block.match(/<source\b[^>]*>([\s\S]*?)<\/source>/i);
    const source = sourceMatch ? decodeXml(sourceMatch[1]) : "";
    const timestamp = Date.parse(pubDate);
    if (!title || !source || !Number.isFinite(timestamp)) continue;
    if (timestamp > now + 60 * 60 * 1000 || now - timestamp > RESEARCH_MAX_AGE_MS) continue;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(link);
    } catch {
      continue;
    }
    if (parsedUrl.protocol !== "https:") continue;
    items.push({
      title: title.slice(0, 240),
      url: parsedUrl.toString(),
      source: source.slice(0, 100),
      publishedAt: new Date(timestamp).toISOString(),
    });
  }
  return items;
}

function tokens(value: string): string[] {
  const stop = new Set([
    "about", "after", "again", "also", "and", "are", "for", "from", "how",
    "into", "its", "more", "new", "not", "now", "our", "that", "the",
    "their", "this", "was", "what", "when", "with", "your", "you",
  ]);
  return (value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])
    .filter((word) => !stop.has(word));
}

export function scoreOpportunity(
  item: ResearchItem,
  keywords: string[],
  now = Date.now()
): ScoredOpportunity {
  const titleTokens = new Set(tokens(item.title));
  const matchedKeywords = Array.from(new Set(keywords.flatMap(tokens)))
    .filter((keyword) => titleTokens.has(keyword));
  const ageHours = Math.max(0, (now - Date.parse(item.publishedAt)) / 3600000);
  const freshness = ageHours <= 24 ? 1.2 : ageHours <= 72 ? 0.8 : 0.4;
  const evidence = item.source ? 0.8 : 0;
  const score = matchedKeywords.length * 1.1 + freshness + evidence;
  return {
    ...item,
    score: Number(score.toFixed(2)),
    matchedKeywords,
    relevance: score >= 4 ? "high" : score >= 2.5 ? "medium" : "low",
  };
}

export function isDuplicateOpportunity(title: string, previousTitles: string[]): boolean {
  const candidate = new Set(tokens(title));
  if (candidate.size === 0) return false;
  return previousTitles.some((previous) => {
    const other = new Set(tokens(previous));
    if (other.size === 0) return false;
    const intersection = Array.from(candidate).filter((word) => other.has(word)).length;
    const union = new Set([...candidate, ...other]).size;
    return union > 0 && intersection / union >= 0.55;
  });
}

function flattenAudience(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const values = Object.values(value as Record<string, unknown>);
  return values.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (Array.isArray(entry)) return entry.filter((x): x is string => typeof x === "string");
    return [];
  });
}

function researchKeywords(strategy: any): string[] {
  const pillars = Array.isArray(strategy.pillars)
    ? strategy.pillars.map((pillar: any) => typeof pillar === "string" ? pillar : pillar?.name ?? pillar?.title ?? "")
    : [];
  return [
    ...pillars,
    ...(strategy.goals ?? []),
    ...flattenAudience(strategy.audience),
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function buildResearchQuery(strategy: any): string {
  const keywords = researchKeywords(strategy)
    .flatMap(tokens)
    .filter((word, index, all) => all.indexOf(word) === index)
    .slice(0, 8);
  if (keywords.length === 0) return "";
  return keywords.slice(0, 5).join(" ");
}

async function fetchResearch(query: string): Promise<ResearchItem[]> {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/rss+xml, application/xml, text/xml" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Research provider returned HTTP " + response.status);
    const xml = await response.text();
    return parseResearchFeed(xml);
  } finally {
    clearTimeout(timeout);
  }
}

async function recordAgentEvent(
  supabase: any,
  workspaceId: string,
  action: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from("audit_events").insert({
    workspace_id: workspaceId,
    actor_type: "system",
    action,
    resource_type: "agent_cycle",
    safe_metadata: metadata,
  });
  if (error) throw new Error("Could not persist agent decision: " + error.message);
}

function periodFor(date = new Date()): { periodStart: string; periodEnd: string } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  };
}

export async function enqueueAutonomousCycles(supabaseOverride?: any): Promise<{ queued: number; skipped: number }> {
  const supabase = supabaseOverride || createServiceClient();
  const { data: workspaces, error } = await supabase
    .from("workspaces")
    .select("id, owner_user_id, state, entitlement_type, operating_mode, paused_at")
    .in("state", [...ACTIVE_STATES])
    .in("entitlement_type", [...ELIGIBLE_ENTITLEMENTS])
    .is("paused_at", null);
  if (error) throw new Error("Could not find eligible workspaces: " + error.message);

  let queued = 0;
  let skipped = 0;
  const cycleDate = new Date().toISOString().slice(0, 10);

  for (const workspace of workspaces ?? []) {
    const [{ data: strategy, error: strategyError }, { data: linkedin, error: linkedinError }] =
      await Promise.all([
        supabase.from("content_strategies").select("id").eq("workspace_id", workspace.id).maybeSingle(),
        supabase.from("integration_connections").select("id").eq("workspace_id", workspace.id)
          .eq("provider", "linkedin").eq("status", "connected").maybeSingle(),
      ]);
    if (strategyError || linkedinError) {
      throw new Error("Could not verify agent prerequisites for workspace " + workspace.id);
    }
    if (!strategy || !linkedin) {
      skipped++;
      continue;
    }

    const idempotencyKey = "autonomous-cycle:" + cycleDate;
    const { error: insertError } = await supabase.from("agent_jobs").insert({
      workspace_id: workspace.id,
      job_type: "agent_cycle",
      status: "queued",
      idempotency_key: idempotencyKey,
      payload: { cycleDate },
      scheduled_for: new Date().toISOString(),
      attempt_count: 0,
      max_attempts: 2,
    });
    if (insertError) {
      if (insertError.code === "23505") {
        skipped++;
        continue;
      }
      throw new Error("Could not enqueue agent cycle for workspace " + workspace.id + ": " + insertError.message);
    }
    queued++;
  }
  return { queued, skipped };
}

export async function executeAutonomousCycle(
  job: AgentJob,
  supabaseOverride?: any
): Promise<JobExecutionResult> {
  const supabase = supabaseOverride || createServiceClient();
  const fail = (error: string, retryable = true): JobExecutionResult => ({
    jobId: job.id,
    success: false,
    status: retryable ? "failed_retryable" : "failed_terminal",
    retryable,
    error,
  });

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("*")
    .eq("id", job.workspace_id)
    .single();
  if (workspaceError || !workspace) return fail("Workspace not found.", false);
  if (workspace.paused_at || !ACTIVE_STATES.includes(workspace.state)) {
    await recordAgentEvent(supabase, workspace.id, "agent_cycle_skipped", {
      reason: "workspace_paused_or_inactive",
      cycleDate: (job.payload as any)?.cycleDate,
    });
    return { jobId: job.id, success: true, status: "succeeded", retryable: false };
  }
  if (!ELIGIBLE_ENTITLEMENTS.includes(workspace.entitlement_type)) {
    return fail("Workspace entitlement no longer permits autonomous operation.", false);
  }

  const [{ data: strategy, error: strategyError }, { data: voice, error: voiceError }] =
    await Promise.all([
      supabase.from("content_strategies").select("*").eq("workspace_id", workspace.id).maybeSingle(),
      supabase.from("voice_profiles").select("*").eq("workspace_id", workspace.id).maybeSingle(),
    ]);
  if (strategyError || voiceError) return fail("Could not load workspace strategy and voice.");
  if (!strategy) return fail("Content strategy is not configured.", false);

  const { data: recentPosts, error: postsError } = await supabase
    .from("content_posts")
    .select("internal_title, text, status, created_at")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (postsError) return fail("Could not load publishing history.");

  const cycleDate = String((job.payload as any)?.cycleDate ?? new Date().toISOString().slice(0, 10));
  const cycleKey = workspace.id + ":" + cycleDate;
  const existingCyclePost = await supabase
    .from("content_posts")
    .select("id, internal_title, status")
    .eq("workspace_id", workspace.id)
    .eq("agent_cycle_key", cycleKey)
    .maybeSingle();
  if (existingCyclePost.error) return fail("Could not check cycle idempotency.");
  if (existingCyclePost.data) {
    return { jobId: job.id, success: true, status: "succeeded", retryable: false };
  }

  const activeRecentPosts = (recentPosts ?? []).filter((post: any) =>
    ["draft", "needs_review", "approved", "scheduled", "published"].includes(post.status)
  );
  if (activeRecentPosts.length >= Math.max(1, Number(strategy.cadence_per_week ?? 3))) {
    await recordAgentEvent(supabase, workspace.id, "agent_cycle_decision", {
      cycleDate,
      decision: "no_op",
      reason: "weekly_cadence_already_met",
      activeRecentPosts: activeRecentPosts.length,
      cadencePerWeek: strategy.cadence_per_week,
    });
    return { jobId: job.id, success: true, status: "succeeded", retryable: false };
  }

  const { periodStart, periodEnd } = periodFor();
  const { data: usage, error: usageError } = await supabase
    .from("usage_counters")
    .select("count")
    .eq("workspace_id", workspace.id)
    .eq("metric", "draft_items_created")
    .eq("period_start", periodStart)
    .maybeSingle();
  if (usageError) return fail("Could not verify monthly draft usage.");
  if ((usage?.count ?? 0) >= 30) {
    await recordAgentEvent(supabase, workspace.id, "agent_cycle_decision", {
      cycleDate,
      decision: "no_op",
      reason: "monthly_draft_limit_reached",
      usageCount: usage.count,
      usageLimit: 30,
    });
    return { jobId: job.id, success: true, status: "succeeded", retryable: false };
  }

  const keywords = researchKeywords(strategy);
  const query = buildResearchQuery(strategy);
  if (!query) {
    await recordAgentEvent(supabase, workspace.id, "agent_cycle_decision", {
      cycleDate,
      decision: "no_op",
      reason: "insufficient_business_context",
    });
    return { jobId: job.id, success: true, status: "succeeded", retryable: false };
  }

  const research = await fetchResearch(query);
  const scored = research
    .map((item) => scoreOpportunity(item, keywords))
    .filter((item) => item.score >= 2.5)
    .sort((a, b) => b.score - a.score);
  const previousTitles = activeRecentPosts.map((post: any) => String(post.internal_title ?? ""));
  const opportunity = scored.find((item) => !isDuplicateOpportunity(item.title, previousTitles));

  if (!opportunity) {
    await recordAgentEvent(supabase, workspace.id, "agent_cycle_decision", {
      cycleDate,
      decision: "no_op",
      reason: research.length === 0 ? "no_fresh_research" : "no_relevant_non_repetitive_opportunity",
      researchCount: research.length,
      candidateCount: scored.length,
      query,
      retrievedAt: new Date().toISOString(),
    });
    return { jobId: job.id, success: true, status: "succeeded", retryable: false };
  }

  const recentApprovalEvents = await supabase
    .from("approval_events")
    .select("action, reason, created_at")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (recentApprovalEvents.error) return fail("Could not load approval learning signals.");

  const approvalSummary = (recentApprovalEvents.data ?? []).reduce(
    (summary: Record<string, number>, event: any) => {
      summary[event.action] = (summary[event.action] ?? 0) + 1;
      return summary;
    },
    {}
  );

  const title = opportunity.title;
  const pillar = (Array.isArray(strategy.pillars) ? strategy.pillars : [])
    .map((item: any) => typeof item === "string" ? item : item?.name ?? item?.title ?? "")
    .find((item: string) => tokens(item).some((token) => opportunity.matchedKeywords.includes(token))) ??
    (Array.isArray(strategy.pillars) ? strategy.pillars[0] : null);
  const pillarName = typeof pillar === "string" ? pillar : pillar?.name ?? pillar?.title ?? undefined;

  const generated = await aiService.generateDraft({
    topic: "What this development means for " + String(workspace.name ?? "your business") + ": " + title,
    pillar: pillarName,
    notes: [
      "Research source: " + opportunity.source,
      "Source title: " + title,
      "Source URL: " + opportunity.url,
      "Published: " + opportunity.publishedAt,
      "Retrieved: " + new Date().toISOString(),
      "Relevance score: " + opportunity.score,
      "Matched business keywords: " + opportunity.matchedKeywords.join(", "),
      "Write a useful, original perspective for this workspace's audience. Attribute factual claims to the source. Do not claim facts not supported by the source title and metadata.",
      "Recent internal approval signals: " + JSON.stringify(approvalSummary),
    ].join("\n"),
    targetLength: "medium",
    voiceProfile: voice ? {
      tone: voice.tone,
      sentenceLength: voice.sentence_length,
      formality: voice.formality,
      phrasesUse: voice.phrases_use,
      phrasesAvoid: voice.phrases_avoid,
      sampleText: voice.sample_text,
      exclusions: voice.exclusions,
    } : undefined,
    strategy: {
      audience: strategy.audience,
      goals: strategy.goals,
      pillars: Array.isArray(strategy.pillars) ? strategy.pillars.map((p: any) => typeof p === "string" ? p : p?.name ?? p?.title ?? "") : [],
      exclusions: strategy.exclusions,
      ctaPreferences: strategy.cta_preferences,
    },
    companyName: workspace.name,
  });

  if (generated.providerUsed === "mock_deterministic") {
    await recordAgentEvent(supabase, workspace.id, "agent_cycle_decision", {
      cycleDate,
      decision: "no_op",
      reason: "real_ai_provider_unavailable",
      sourceTitle: title,
      sourceUrl: opportunity.url,
    });
    return { jobId: job.id, success: true, status: "succeeded", retryable: false };
  }

  const autopilot = workspace.state === "active_autopilot" && workspace.operating_mode === "autopilot";
  const approvalMode = workspace.state === "active_approval_required" && workspace.operating_mode === "approval_required";
  if (!autopilot && !approvalMode) {
    return fail("Workspace operating mode and state do not agree; refusing autonomous action.", false);
  }

  const { data: post, error: postError } = await supabase
    .from("content_posts")
    .insert({
      workspace_id: workspace.id,
      agent_cycle_key: cycleKey,
      created_by: workspace.owner_user_id,
      text: generated.text.slice(0, 3000),
      internal_title: title.slice(0, 180),
      pillar: pillarName ?? null,
      source_notes: "Source: " + opportunity.source + "\n" + opportunity.url + "\nPublished: " + opportunity.publishedAt,
      status: autopilot ? "approved" : "draft",
      scheduled_at: autopilot ? new Date().toISOString() : null,
      version: 1,
    })
    .select()
    .single();

  if (postError || !post) {
    if (postError?.code === "23505") {
      return { jobId: job.id, success: true, status: "succeeded", retryable: false };
    }
    return fail("Could not save the agent-generated post: " + (postError?.message ?? "unknown database error"));
  }

  const { error: versionError } = await supabase.from("content_post_versions").insert({
    workspace_id: workspace.id,
    post_id: post.id,
    version_number: 1,
    text: generated.text.slice(0, 3000),
    change_source: "ai_generation",
    changed_by: workspace.owner_user_id,
  });
  if (versionError && versionError.code !== "23505") {
    return fail("Could not save the generated post version: " + versionError.message);
  }

  const { error: usageIncrementError } = await supabase.rpc("increment_usage_counter", {
    p_workspace_id: workspace.id,
    p_metric: "draft_items_created",
    p_period_start: periodStart,
    p_period_end: periodEnd,
  });
  if (usageIncrementError) {
    console.error("[agent-cycle] Draft saved but usage counter increment failed: " + usageIncrementError.message);
  }

  await recordAgentEvent(supabase, workspace.id, "agent_cycle_decision", {
    cycleDate,
    decision: autopilot ? "queue_autopilot_publish" : "create_review_draft",
    postId: post.id,
    sourceTitle: opportunity.title,
    sourceUrl: opportunity.url,
    sourceName: opportunity.source,
    sourcePublishedAt: opportunity.publishedAt,
    retrievedAt: new Date().toISOString(),
    relevanceScore: opportunity.score,
    matchedKeywords: opportunity.matchedKeywords,
    confidence: opportunity.relevance,
    aiProvider: generated.providerUsed,
    aiModel: generated.modelUsed,
    approvalSignals: approvalSummary,
  });

  if (autopilot) {
    const publishKey = "publish-" + workspace.id + "-" + post.id;
    const { error: publishJobError } = await supabase.from("agent_jobs").insert({
      workspace_id: workspace.id,
      job_type: "publish_post",
      status: "queued",
      idempotency_key: publishKey,
      payload: {
        postId: post.id,
        workspaceId: workspace.id,
        userId: workspace.owner_user_id,
        targetProvider: "linkedin",
        scheduledFor: new Date().toISOString(),
      },
      scheduled_for: new Date().toISOString(),
      attempt_count: 0,
      max_attempts: 3,
    });
    if (publishJobError && publishJobError.code !== "23505") {
      return fail("Post was created but the publish job could not be queued: " + publishJobError.message);
    }
    await notifyWorkspaceTelegram(workspace.id, {
      text: "Nunuza found a timely opportunity and queued a post under your enabled Autopilot settings: " + title,
    }, supabase);
  } else {
    await notifyWorkspaceTelegram(workspace.id, {
      text: "Nunuza found a relevant opportunity and created a draft for your review: " + title + ". Use /drafts in Telegram or open your dashboard.",
    }, supabase);
  }

  return { jobId: job.id, success: true, status: "succeeded", retryable: false };
}
