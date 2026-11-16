/**
 * Nunuza autonomous operating cycle.
 *
 * Uses the existing durable worker, workspace strategy, voice profile, content
 * posts, approval events, usage counters, audit events and Telegram delivery.
 * No parallel scheduler and no customer-supplied topic are required.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { aiService } from "@/lib/ai/service";
import { notifyAgentSkip } from "@/lib/notifications/agent-alerts";
import { checkDraftAgainstSource } from "@/lib/ai/draft-check";
import { assertVoiceConstraints, VoiceConstraintError } from "@/lib/ai/voice-constraints";
import { notifyWorkspaceTelegram, notifyWorkspaceTelegramDraft, type TelegramBrowserBinding } from "@/lib/integrations/telegram/service";
import { canUseAutopilot } from "@/lib/auth/workspace";
import { getDraftUsagePeriod } from "@/lib/db/usage";
import { getPolarService } from "@/lib/integrations/polar/service";
import { scheduleApprovedPost, formatScheduledTime, AUTOPILOT_VETO_WINDOW_MS } from "./agent-scheduling";
import type { AgentJob } from "@/types/database";
import type { JobExecutionResult } from "./types";

const ELIGIBLE_ENTITLEMENTS = [
  "internal_beta",
  "paid_trial",
  "paid_active",
] as const;
const ACTIVE_STATES = ["active_approval_required", "active_autopilot"] as const;

/** Only current beta/paid entitlements may run autonomous cycles. Legacy
 * publishing_beta/internal_test remain manual compatibility entitlements. */
export function isAutonomousEntitlementEligible(entitlement: string): boolean {
  return (ELIGIBLE_ENTITLEMENTS as readonly string[]).includes(entitlement);
}

export function isAutonomousWorkspaceActive(workspace: {
  state: string;
  paused_at?: string | null;
}): boolean {
  return !workspace.paused_at && (ACTIVE_STATES as readonly string[]).includes(workspace.state);
}

const MAX_FEED_ITEMS = 20;
const RESEARCH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ResearchItem {
  title: string;
  url: string;
  sourceUrl: string;
  source: string;
  evidence: string;
  publishedAt: string;
  retrievedAt: string;
}

export interface ScoredOpportunity extends ResearchItem {
  score: number;
  matchedKeywords: string[];
  relevance: "high" | "medium" | "low";
  scoreBreakdown: {
    businessAudienceRelevance: number;
    timeliness: number;
    evidenceQuality: number;
    potentialValue: number;
    approvalPreference: number;
    editPreference: number;
  };
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const point = Number(code);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff &&
        !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const point = parseInt(code, 16);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff &&
        !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : "";
    })
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tagValue(xml: string, tag: string): string {
  const match = xml.match(new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "i"));
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
    const description = tagValue(block, "description");
    const sourceMatch = block.match(/<source\b([^>]*)>([\s\S]*?)<\/source>/i);
    const source = sourceMatch ? decodeXml(sourceMatch[2]) : "";
    const sourceUrlMatch = sourceMatch?.[1].match(/\burl=["']([^"']+)["']/i);
    const timestamp = Date.parse(pubDate);
    if (!title || !source || !description || description.length < 35 || !Number.isFinite(timestamp)) continue;
    if (timestamp > now + 60 * 60 * 1000 || now - timestamp > RESEARCH_MAX_AGE_MS) continue;
    let parsedUrl: URL;
    let parsedSourceUrl: URL;
    try {
      parsedUrl = new URL(link);
      parsedSourceUrl = new URL(sourceUrlMatch ? decodeXml(sourceUrlMatch[1]) : link);
    } catch {
      continue;
    }
    if (parsedUrl.protocol !== "https:" || parsedSourceUrl.protocol !== "https:") continue;
    items.push({
      title: title.slice(0, 240),
      url: parsedUrl.toString(),
      sourceUrl: parsedSourceUrl.toString(),
      source: source.slice(0, 100),
      evidence: description.slice(0, 1200),
      publishedAt: new Date(timestamp).toISOString(),
      retrievedAt: new Date(now).toISOString(),
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

export interface LearningProfile {
  approvedTerms: string[];
  rejectedTerms: string[];
  preferredEditTerms: string[];
  avoidedEditTerms: string[];
  approvedCount: number;
  rejectedCount: number;
  editCount: number;
}

export function buildLearningProfile(
  posts: Array<{ id: string; internal_title?: string | null; pillar?: string | null; text?: string | null }>,
  approvals: Array<{ post_id: string; action: string }>,
  edits: Array<{ post_id: string; change_source?: string; text?: string | null; version_number?: number }>
): LearningProfile {
  const postById = new Map(posts.map((post) => [post.id, post]));
  const approved = new Set<string>();
  const rejected = new Set<string>();
  const addedTermCounts = new Map<string, number>();
  const removedTermCounts = new Map<string, number>();
  let approvedCount = 0;
  let rejectedCount = 0;
  for (const event of approvals) {
    const post = postById.get(event.post_id);
    if (!post) continue;
    const terms = [...tokens(post.internal_title ?? ""), ...tokens(post.pillar ?? "")];
    if (event.action === "approved") { approvedCount++; terms.forEach((term) => approved.add(term)); }
    if (event.action === "rejected") { rejectedCount++; terms.forEach((term) => rejected.add(term)); }
  }

  const versionsByPost = new Map<string, typeof edits>();
  for (const version of edits) {
    const versions = versionsByPost.get(version.post_id) ?? [];
    versions.push(version);
    versionsByPost.set(version.post_id, versions);
  }
  for (const [postId, versions] of versionsByPost) {
    const post = postById.get(postId);
    if (!post?.text) continue;
    versions.sort((a, b) => (a.version_number ?? 0) - (b.version_number ?? 0));
    const generated = versions.find((version) => version.change_source === "ai_generation") ?? versions[0];
    // Version rows are pre-edit snapshots. Compare the AI original with the
    // current post body, which is the actual final user-edited content.
    if (!generated?.text) continue;
    const before = new Set(tokens(generated.text));
    const after = new Set(tokens(post.text));
    for (const term of after) if (!before.has(term)) addedTermCounts.set(term, (addedTermCounts.get(term) ?? 0) + 1);
    for (const term of before) if (!after.has(term)) removedTermCounts.set(term, (removedTermCounts.get(term) ?? 0) + 1);
  }

  return {
    approvedTerms: [...approved],
    rejectedTerms: [...rejected],
    preferredEditTerms: [...addedTermCounts].filter(([, count]) => count >= 2).map(([term]) => term),
    avoidedEditTerms: [...removedTermCounts].filter(([, count]) => count >= 2).map(([term]) => term),
    approvedCount,
    rejectedCount,
    editCount: edits.filter((version) => version.change_source === "user_edit").length,
  };
}

export function scoreOpportunity(
  item: ResearchItem,
  keywords: string[],
  now = Date.now(),
  learning?: LearningProfile
): ScoredOpportunity {
  // Match both the headline and the publisher's evidence excerpt. A useful
  // story can have a generic headline while the actual customer problem is
  // explained in the excerpt.
  const evidenceTokens = new Set(tokens(item.title + " " + item.evidence));
  const matchedKeywords = Array.from(new Set(keywords.flatMap(tokens))).filter((keyword) => evidenceTokens.has(keyword));
  const approvedMatches = learning?.approvedTerms.filter((term) => evidenceTokens.has(term)).length ?? 0;
  const rejectedMatches = learning?.rejectedTerms.filter((term) => evidenceTokens.has(term)).length ?? 0;
  const preferredEditMatches = learning?.preferredEditTerms.filter((term) => evidenceTokens.has(term)).length ?? 0;
  const avoidedEditMatches = learning?.avoidedEditTerms.filter((term) => evidenceTokens.has(term)).length ?? 0;
  const ageHours = Math.max(0, (now - Date.parse(item.publishedAt)) / 3600000);
  const freshness = ageHours <= 24 ? 1.2 : ageHours <= 72 ? 0.8 : 0.4;
  const evidence = item.source && !!item.sourceUrl
    ? item.evidence.length >= 240 ? 1 : item.evidence.length >= 100 ? 0.75 : 0.45
    : 0;
  const valueTerms = new Set(["cost", "risk", "revenue", "growth", "save", "reduce", "improve", "customer", "market", "regulation", "deadline", "price", "hiring", "funding", "tax", "security", "problem", "profit"]);
  const valueMatches = tokens(item.title + " " + item.evidence).filter((term) => valueTerms.has(term)).length;
  const potentialValue = Math.min(valueMatches * 0.15, 0.6);
  const approvalPreference = Math.min(approvedMatches * 0.25, 0.75) - Math.min(rejectedMatches * 0.6, 1.2);
  const editPreference = Math.min(preferredEditMatches * 0.15, 0.45) - Math.min(avoidedEditMatches * 0.15, 0.45);
  const businessAudienceRelevance = matchedKeywords.length * 1.1;
  const score = businessAudienceRelevance + freshness + evidence + potentialValue + approvalPreference + editPreference;
  return {
    ...item,
    score: Number(score.toFixed(2)),
    matchedKeywords,
    relevance: score >= 4 ? "high" : score >= 2.5 ? "medium" : "low",
    scoreBreakdown: {
      businessAudienceRelevance: Number(businessAudienceRelevance.toFixed(2)),
      timeliness: freshness,
      evidenceQuality: evidence,
      potentialValue: Number(potentialValue.toFixed(2)),
      approvalPreference: Number(approvalPreference.toFixed(2)),
      editPreference: Number(editPreference.toFixed(2)),
    },
  };
}

export function matchesStrategyExclusion(item: ResearchItem, exclusions: string[]): boolean {
  const contentTokens = new Set(tokens(item.title + " " + item.evidence));
  return exclusions.some((phrase) => {
    const exclusionTokens = tokens(phrase);
    return exclusionTokens.length > 0 && exclusionTokens.every((term) => contentTokens.has(term));
  });
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
  return "(" + keywords.slice(0, 5).map((word) => '"' + word + '"').join(" OR ") + ")";
}

export function buildCycleNotificationMessage(mode: "autopilot" | "approval_required"): string {
  // Notifications report what Nunuza did, never relay third-party news headlines or links.
  return mode === "autopilot"
    ? "Nunuza queued a LinkedIn post under your enabled Autopilot settings.\nYou can check its status in Nunuza."
    : "A new LinkedIn draft is ready for your review. It is sent here as an image with buttons to approve or reject it.";
}

/**
 * Second, wider search used when the first one is thin: whole pillar and goal
 * phrases instead of single words, so a niche business still finds stories.
 */
export function buildWidenedResearchQuery(strategy: any): string {
  const phrases = researchKeywords(strategy)
    .map((value) => value.trim().replace(/"/g, ""))
    .filter((value) => value.length >= 3 && value.length <= 60)
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 6);
  return phrases.length ? phrases.map((phrase) => '"' + phrase + '"').join(" OR ") : "";
}

/**
 * Evergreen topic from a content pillar, used only when no fresh story
 * qualifies. It rotates through pillars by day and skips recent titles.
 */
export function buildEvergreenOpportunity(
  strategy: any,
  recentTitles: string[],
  cycleDate: string,
  nowIso = new Date().toISOString()
): ScoredOpportunity | null {
  const pillars: string[] = (Array.isArray(strategy.pillars) ? strategy.pillars : [])
    .map((pillar: any) => typeof pillar === "string" ? pillar : pillar?.name ?? pillar?.title ?? "")
    .filter((name: unknown): name is string => typeof name === "string" && name.trim().length > 0);
  if (pillars.length === 0) return null;
  const dayNumber = Math.floor(new Date(cycleDate + "T00:00:00Z").getTime() / 86400000) || 0;
  for (let offset = 0; offset < pillars.length; offset += 1) {
    const pillar = pillars[(dayNumber + offset) % pillars.length].trim();
    const title = "Evergreen perspective: " + pillar;
    if (isDuplicateOpportunity(title, recentTitles)) continue;
    return {
      title, url: "", sourceUrl: "", source: "Evergreen (no news source)", evidence: "",
      publishedAt: nowIso, retrievedAt: nowIso, score: 0, matchedKeywords: tokens(pillar), relevance: "low",
      scoreBreakdown: { businessAudienceRelevance: 0, timeliness: 0, evidenceQuality: 0, potentialValue: 0, approvalPreference: 0, editPreference: 0 },
    };
  }
  return null;
}

const RESEARCH_TIMEOUT_MS = 20_000;
const RESEARCH_ATTEMPTS = 2;

async function fetchResearchOnce(query: string): Promise<ResearchItem[]> {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESEARCH_TIMEOUT_MS);
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

/** A slow or briefly failing news provider must not cost a customer their daily run. */
export async function fetchResearch(
  query: string,
  fetchOnce: (query: string) => Promise<ResearchItem[]> = fetchResearchOnce,
  pauseMs = 1500
): Promise<ResearchItem[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RESEARCH_ATTEMPTS; attempt += 1) {
    try {
      return await fetchOnce(query);
    } catch (error) {
      lastError = error;
      if (attempt < RESEARCH_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Research provider unavailable");
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
    resource_id: typeof metadata.postId === "string" ? metadata.postId : null,
    safe_metadata: metadata,
  });
  if (error) throw new Error("Could not persist agent decision: " + error.message);
  if (action === "agent_cycle_decision" && metadata.decision === "no_op") {
    await notifyAgentSkip(supabase, workspaceId, metadata.reason, String(metadata.cycleDate ?? new Date().toISOString().slice(0, 10)));
  }
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
    const { data: activeCycles, error: activeCycleError } = await supabase
      .from("agent_jobs")
      .select("id")
      .eq("workspace_id", workspace.id)
      .eq("job_type", "agent_cycle")
      .in("status", ["queued", "running", "failed_retryable"])
      .limit(1);
    if (activeCycleError) throw new Error("Could not check active cycles for workspace " + workspace.id);
    if (activeCycles?.length) {
      skipped++;
      continue;
    }

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

export function isValidCycleDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(value + "T00:00:00.000Z");
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}


/**
 * Autopilot with a veto window: the post goes on the workspace's next preferred
 * slot (never sooner than the veto window) and the user gets the draft image
 * with a Stop button. If it cannot be scheduled (caps, pause) it becomes a
 * normal review draft instead of being dropped or published blindly.
 */
async function scheduleAutopilotPost(
  supabase: any,
  workspace: any,
  post: { id: string; internal_title?: string | null; text?: string | null; status?: string },
  browserBinding: TelegramBrowserBinding | undefined,
  notify = true
): Promise<{ ok: true } | { ok: false; retryable: boolean; message: string }> {
  const scheduled = await scheduleApprovedPost(supabase, {
    workspaceId: workspace.id, ownerUserId: workspace.owner_user_id, postId: post.id,
    minLeadMs: AUTOPILOT_VETO_WINDOW_MS, autopilot: true,
  });
  if (scheduled.ok) {
    if (notify) {
      await notifyWorkspaceTelegramDraft(workspace.id, post, {
        supabase, browser: browserBinding,
        scheduledLabel: formatScheduledTime(scheduled.scheduledFor, scheduled.timezone),
      });
    }
    return { ok: true };
  }
  if (scheduled.reason === "RPC_ERROR") {
    return { ok: false, retryable: true, message: "Post was created but could not be scheduled; the cycle will retry." };
  }
  // Caps, pause or state conflicts: hand the post to the user for review.
  await supabase.from("content_posts").update({ status: "needs_review", scheduled_at: null })
    .eq("id", post.id).eq("workspace_id", workspace.id).eq("status", "approved");
  await recordAgentEvent(supabase, workspace.id, "agent_cycle_decision", {
    decision: "autopilot_scheduling_deferred_to_review", reason: scheduled.reason, postId: post.id,
  });
  if (notify) await notifyWorkspaceTelegramDraft(workspace.id, post, { supabase, browser: browserBinding });
  return { ok: true };
}
export async function executeAutonomousCycle(
  job: AgentJob,
  supabaseOverride?: any,
  browserBinding?: TelegramBrowserBinding
): Promise<JobExecutionResult> {
  const supabase = supabaseOverride || createServiceClient();
  const fail = (error: string, retryable = true): JobExecutionResult => ({
    jobId: job.id,
    success: false,
    status: retryable ? "failed_retryable" : "failed_terminal",
    retryable,
    error,
  });

  const requestedCycleDate = (job.payload as any)?.cycleDate;
  if (requestedCycleDate !== undefined && !isValidCycleDate(requestedCycleDate)) {
    return fail("Invalid autonomous cycle date payload.", false);
  }
  const cycleDate = requestedCycleDate ?? new Date().toISOString().slice(0, 10);

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("*")
    .eq("id", job.workspace_id)
    .single();
  if (workspaceError || !workspace) return fail("Workspace not found.", false);

  try {
    workspace.entitlement_type = await getPolarService().getVerifiedWorkspaceEntitlement(
      workspace.id,
      supabase
    );
  } catch (error) {
    console.error("[agent] Polar entitlement verification failed:", error);
    return fail("Billing status could not be verified. The autonomous cycle will retry.");
  }

  if (!isAutonomousWorkspaceActive(workspace)) {
    await recordAgentEvent(supabase, workspace.id, "agent_cycle_skipped", {
      reason: "workspace_paused_or_inactive",
      cycleDate: (job.payload as any)?.cycleDate,
    });
    return { jobId: job.id, success: true, status: "succeeded", retryable: false };
  }
  if (!isAutonomousEntitlementEligible(workspace.entitlement_type)) {
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
    .gte("created_at", new Date(Date.now() - 7 * 86400000).toISOString())
    .order("created_at", { ascending: false })
    .limit(50);
  if (postsError) return fail("Could not load publishing history.");

  const cycleKey = workspace.id + ":" + cycleDate;
  const existingCyclePost = await supabase
    .from("content_posts")
    .select("id, internal_title, status, text, pillar")
    .eq("workspace_id", workspace.id)
    .eq("agent_cycle_key", cycleKey)
    .maybeSingle();
  if (existingCyclePost.error) return fail("Could not check cycle idempotency.");
  if (existingCyclePost.data) {
    // A previous worker may have crashed after inserting the post but before
    // saving its version, recording the decision, or enqueueing Autopilot.
    const existingPost = existingCyclePost.data;
    const { data: version, error: versionLookupError } = await supabase
      .from("content_post_versions")
      .select("id")
      .eq("workspace_id", workspace.id)
      .eq("post_id", existingPost.id)
      .eq("version_number", 1)
      .maybeSingle();
    if (versionLookupError) return fail("Could not verify the recovered post version.");
    if (!version) {
      const { error: versionRepairError } = await supabase.from("content_post_versions").insert({
        workspace_id: workspace.id,
        post_id: existingPost.id,
        version_number: 1,
        text: existingPost.text,
        change_source: "ai_generation",
        changed_by: workspace.owner_user_id,
      });
      if (versionRepairError && versionRepairError.code !== "23505") {
        return fail("Could not repair the recovered post version.");
      }
    }

    const recoveredAutopilot = workspace.state === "active_autopilot" &&
      workspace.operating_mode === "autopilot" && canUseAutopilot(workspace);
    let recoveredNotified = false;
    if (recoveredAutopilot && existingPost.status === "approved") {
      const { data: priorDecisionForPost } = await supabase.from("audit_events").select("id")
        .eq("workspace_id", workspace.id).eq("resource_id", existingPost.id)
        .eq("action", "agent_cycle_decision").maybeSingle();
      const outcome = await scheduleAutopilotPost(supabase, workspace, existingPost, browserBinding, !priorDecisionForPost);
      if (!outcome.ok && outcome.retryable) return fail(outcome.message);
      recoveredNotified = !priorDecisionForPost;
    }

    const { data: priorDecision, error: decisionLookupError } = await supabase
      .from("audit_events")
      .select("id")
      .eq("workspace_id", workspace.id)
      .eq("resource_id", existingPost.id)
      .eq("action", "agent_cycle_decision")
      .maybeSingle();
    if (decisionLookupError) return fail("Could not verify the recovered agent decision.");
    if (!priorDecision) {
      await recordAgentEvent(supabase, workspace.id, "agent_cycle_decision", {
        cycleDate,
        decision: recoveredAutopilot ? "queue_autopilot_publish" : "create_review_draft",
        reason: "recovered_after_worker_interruption",
        postId: existingPost.id,
        sourceTitle: existingPost.internal_title,
      });
      if (recoveredAutopilot) {
        // The scheduled preview (with Stop) was already sent above.
        if (!recoveredNotified) await notifyWorkspaceTelegramDraft(workspace.id, existingPost, { supabase, browser: browserBinding });
      } else {
        // The recovered draft goes out as an image with the review buttons.
        await notifyWorkspaceTelegramDraft(workspace.id, existingPost, { supabase, browser: browserBinding });
      }
    }

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

  const quotaPeriod = await getDraftUsagePeriod(workspace.id, workspace.owner_user_id, supabase);
  const { data: usageData, error: usageError } = await supabase.rpc("get_draft_usage_status", {
    p_workspace_id: workspace.id,
    p_owner_user_id: workspace.owner_user_id,
    p_period_start: quotaPeriod.periodStart,
    p_metric: quotaPeriod.metric,
  });
  if (usageError) return fail("Could not verify monthly draft usage.");
  const usage = Array.isArray(usageData) ? usageData[0] : usageData;
  const usageCount = Number(usage?.used_count ?? 0) + Number(usage?.reserved_count ?? 0);
  if (usageCount >= 30) {
    await recordAgentEvent(supabase, workspace.id, "agent_cycle_decision", {
      cycleDate,
      decision: "no_op",
      reason: "monthly_draft_limit_reached",
      usageCount,
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

  let research: ResearchItem[];
  try {
    research = await fetchResearch(query);
  } catch {
    await recordAgentEvent(supabase, workspace.id, "agent_cycle_decision", {
      cycleDate,
      decision: "research_unavailable",
      reason: "news_provider_did_not_respond",
      nextAction: "retry_shortly",
      query,
    });
    return fail("Recent news could not be reached. Nunuza will try again shortly.");
  }
  if (research.length < 3) {
    const widened = buildWidenedResearchQuery(strategy);
    if (widened && widened !== query) {
      try {
        const extra = await fetchResearch(widened);
        const known = new Set(research.map((item) => item.url));
        research = [...research, ...extra.filter((item) => !known.has(item.url))];
      } catch {
        // The first search already succeeded; widening is best effort.
      }
    }
  }
  const learningSince = new Date(Date.now() - 90 * 86400000).toISOString();
  const [{ data: approvalEvents, error: approvalError }, { data: editVersions, error: editError }] =
    await Promise.all([
      supabase.from("approval_events").select("post_id, action, reason, created_at")
        .eq("workspace_id", workspace.id).gte("created_at", learningSince)
        .order("created_at", { ascending: false }).limit(100),
      supabase.from("content_post_versions").select("post_id, change_source, text, version_number, created_at")
        .eq("workspace_id", workspace.id).in("change_source", ["ai_generation", "user_edit"])
        .gte("created_at", learningSince).order("created_at", { ascending: true }).limit(200),
    ]);
  if (approvalError || editError) return fail("Could not load internal learning signals.");
  const signalPostIds = [...new Set([
    ...(approvalEvents ?? []).map((event: any) => event.post_id),
    ...(editVersions ?? []).map((version: any) => version.post_id),
  ])];
  let signalPosts: any[] = [];
  if (signalPostIds.length) {
    const { data, error } = await supabase.from("content_posts")
      .select("id, internal_title, pillar, text").eq("workspace_id", workspace.id).in("id", signalPostIds);
    if (error) return fail("Could not load posts for learning signals.");
    signalPosts = data ?? [];
  }
  const learning = buildLearningProfile(signalPosts, approvalEvents ?? [], editVersions ?? []);
  const approvalSummary = {
    approved: learning.approvedCount, rejected: learning.rejectedCount, userEdits: learning.editCount,
    learnedApprovedTerms: learning.approvedTerms.slice(0, 20),
    learnedRejectedTerms: learning.rejectedTerms.slice(0, 20),
    preferredEditTerms: learning.preferredEditTerms.slice(0, 20),
    avoidedEditTerms: learning.avoidedEditTerms.slice(0, 20),
  };

  const ranked = research
    .map((item) => scoreOpportunity(item, keywords, Date.now(), learning))
    .sort((a, b) => b.score - a.score);
  const strategyExclusions = [
    ...(Array.isArray(strategy.exclusions)
      ? strategy.exclusions.filter((value: unknown): value is string => typeof value === "string")
      : []),
    ...(Array.isArray(voice?.exclusions)
      ? voice.exclusions.filter((value: unknown): value is string => typeof value === "string")
      : []),
  ];
  const excludedByBrand = ranked.filter((item) => matchesStrategyExclusion(item, strategyExclusions));
  const eligibleByBrand = ranked.filter((item) => !matchesStrategyExclusion(item, strategyExclusions));
  for (const candidate of ranked.slice(0, 5)) {
    const brandExcluded = matchesStrategyExclusion(candidate, strategyExclusions);
    const insufficientEvidence = candidate.scoreBreakdown.evidenceQuality < 0.6;
    const eligible = candidate.score >= 2.5 && !brandExcluded && !insufficientEvidence;
    await recordAgentEvent(supabase, workspace.id, "agent_research_candidate", {
      cycleDate, title: candidate.title, source: candidate.source,
      sourceUrl: candidate.sourceUrl, articleUrl: candidate.url,
      publishedAt: candidate.publishedAt, retrievedAt: candidate.retrievedAt,
      evidence: candidate.evidence.slice(0, 800), relevanceScore: candidate.score,
      confidence: candidate.relevance, matchedKeywords: candidate.matchedKeywords,
      scoreBreakdown: candidate.scoreBreakdown,
      eligible,
      decision: brandExcluded ? "reject" : insufficientEvidence ? "more_research_required" : eligible ? "consider" : "monitor",
      decisionReason: brandExcluded
        ? "strategy_exclusion"
        : insufficientEvidence
          ? "insufficient_evidence_more_research_required"
          : eligible ? "relevance_threshold_met" : "below_relevance_threshold",
    });
  }
  const scored = eligibleByBrand.filter((item) =>
    item.score >= 2.5 && item.scoreBreakdown.evidenceQuality >= 0.6
  );

  const consideredSince = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data: priorResearchEvents, error: priorResearchError } = await supabase
    .from("audit_events")
    .select("safe_metadata")
    .eq("workspace_id", workspace.id)
    .eq("action", "agent_research_candidate")
    .gte("created_at", consideredSince)
    .limit(200);
  if (priorResearchError) return fail("Could not load recent research history.");

  const previousResearchTitles = (priorResearchEvents ?? [])
    .filter((event: any) => event.safe_metadata?.cycleDate !== cycleDate)
    .map((event: any) => event.safe_metadata?.title)
    .filter((title: unknown): title is string => typeof title === "string");
  const previousTitles = [
    ...activeRecentPosts.map((post: any) => String(post.internal_title ?? "")),
    ...previousResearchTitles,
  ];
  let opportunity = scored.find((item) => !isDuplicateOpportunity(item.title, previousTitles));
  const evergreenCandidate = !opportunity && !(ranked.length > 0 && excludedByBrand.length === ranked.length)
    ? buildEvergreenOpportunity(strategy, previousTitles, cycleDate)
    : null;
  const isEvergreen = !opportunity && !!evergreenCandidate;
  if (evergreenCandidate && !opportunity) opportunity = evergreenCandidate;

  if (!opportunity) {
    await recordAgentEvent(supabase, workspace.id, "agent_cycle_decision", {
      cycleDate,
      decision: research.length === 0
        ? "no_op"
        : excludedByBrand.length === ranked.length
          ? "reject"
          : ranked.some((item) => item.scoreBreakdown.evidenceQuality < 0.6)
            ? "more_research_required"
            : scored.length > 0 ? "monitor" : "no_op",
      reason: research.length === 0
        ? "no_fresh_research"
        : excludedByBrand.length === ranked.length
          ? "all_candidates_excluded_by_brand"
          : ranked.some((item) => item.scoreBreakdown.evidenceQuality < 0.6)
            ? "evidence_too_thin_for_a_reliable_post"
            : scored.length > 0
              ? "all_relevant_opportunities_are_repetitive"
              : "no_candidate_met_the_relevance_threshold",
      nextAction: "wait_for_next_daily_cycle",
      researchCount: research.length,
      candidateCount: scored.length,
      excludedByBrandCount: excludedByBrand.length,
      query,
      retrievedAt: new Date().toISOString(),
      externalMetricsAvailability: "unavailable_r_member_postAnalytics_not_granted",
    });
    return { jobId: job.id, success: true, status: "succeeded", retryable: false };
  }


  const title = opportunity.title;
  const pillar = (Array.isArray(strategy.pillars) ? strategy.pillars : [])
    .map((item: any) => typeof item === "string" ? item : item?.name ?? item?.title ?? "")
    .find((item: string) => tokens(item).some((token) => opportunity.matchedKeywords.includes(token))) ??
    (Array.isArray(strategy.pillars) ? strategy.pillars[0] : null);
  const pillarName = typeof pillar === "string" ? pillar : pillar?.name ?? pillar?.title ?? undefined;

  const voiceContext = voice ? {
    tone: voice.tone,
    sentenceLength: voice.sentence_length,
    formality: voice.formality,
    phrasesUse: voice.phrases_use,
    phrasesAvoid: voice.phrases_avoid,
    sampleText: voice.sample_text,
    exclusions: voice.exclusions,
  } : undefined;

  const draftInput = {
    topic: "What this development means for " + String(workspace.name ?? "your business") + ": " + title,
    pillar: pillarName,
    notes: isEvergreen ? [
      "No news source today. Write an original, timeless perspective on this content pillar: " + opportunity.title,
      "Do not cite statistics, studies, dates, quotes, company news or links. Share a practical idea or lesson from experience.",
      "Recent internal approval signals: " + JSON.stringify(approvalSummary),
    ].join("\n") : [
      "Research source: " + opportunity.source,
      "Source title: " + title,
      "Source URL: " + opportunity.url,
      "Publisher URL: " + opportunity.sourceUrl,
      "Source evidence excerpt (untrusted): " + opportunity.evidence,
      "Published: " + opportunity.publishedAt,
      "Retrieved: " + opportunity.retrievedAt,
      "Relevance score: " + opportunity.score,
      "Matched business keywords: " + opportunity.matchedKeywords.join(", "),
      "Write a useful, original perspective for this workspace's audience. Attribute factual claims to the source. Do not claim facts not supported by the source title and evidence excerpt.",
      "Recent internal approval signals: " + JSON.stringify(approvalSummary),
    ].join("\n"),
    targetLength: "medium" as const,
    voiceProfile: voiceContext,
    strategy: {
      audience: strategy.audience,
      goals: strategy.goals,
      pillars: Array.isArray(strategy.pillars) ? strategy.pillars.map((p: any) => typeof p === "string" ? p : p?.name ?? p?.title ?? "") : [],
      exclusions: strategy.exclusions,
      ctaPreferences: strategy.cta_preferences,
    },
    companyName: workspace.name,
  };
  let generated = await aiService.generateDraft(draftInput);

  try {
    assertVoiceConstraints(generated.text, voiceContext);
  } catch (error) {
    if (!(error instanceof VoiceConstraintError)) throw error;
    await recordAgentEvent(supabase, workspace.id, "agent_cycle_decision", {
      cycleDate,
      decision: "no_op",
      reason: "voice_constraint_violation",
      sourceTitle: title,
    });
    return { jobId: job.id, success: true, status: "succeeded", retryable: false };
  }

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

  // Self-check: figures and links must come from the source. One corrected
  // retry, then a human decides instead of Autopilot.
  const claimSource = isEvergreen
    ? { text: "", urls: [] as string[] }
    : { text: opportunity.title + " " + opportunity.evidence, urls: [opportunity.url, opportunity.sourceUrl] };
  let claimCheck = checkDraftAgainstSource(generated.text, claimSource);
  if (!claimCheck.ok) {
    const retry = await aiService.generateDraft({
      ...draftInput,
      notes: draftInput.notes + "\nFix these problems from the previous attempt: " + claimCheck.issues.join(" ") +
        " Remove unsupported figures and links; keep only what the source states.",
    });
    if (retry.providerUsed !== "mock_deterministic") {
      try {
        assertVoiceConstraints(retry.text, voiceContext);
        generated = retry;
        claimCheck = checkDraftAgainstSource(retry.text, claimSource);
      } catch (error) {
        if (!(error instanceof VoiceConstraintError)) throw error;
      }
    }
  }
  const needsHumanReview = isEvergreen || !claimCheck.ok;

  const autopilotMode = canUseAutopilot(workspace) && workspace.state === "active_autopilot";
  const autopilot = autopilotMode && !needsHumanReview;
  const approvalMode = workspace.state === "active_approval_required" && workspace.operating_mode === "approval_required";
  if (autopilotMode) {
    const { data: connection, error: connectionError } = await supabase.from("integration_connections")
      .select("status, expires_at, granted_scopes").eq("workspace_id", workspace.id)
      .eq("provider", "linkedin").maybeSingle();
    const scopes = Array.isArray(connection?.granted_scopes) ? connection.granted_scopes : [];
    const expiry = connection?.expires_at ? new Date(connection.expires_at).getTime() : Number.NaN;
    const ready = !connectionError && connection?.status === "connected" &&
      Number.isFinite(expiry) && expiry > Date.now() &&
      scopes.includes("w_member_social");
    if (!ready) {
      await recordAgentEvent(supabase, workspace.id, "agent_cycle_decision", {
        cycleDate, decision: "no_op", reason: "autopilot_linkedin_connection_or_scope_unavailable",
      });
      return { jobId: job.id, success: true, status: "succeeded", retryable: false };
    }
  }
  if (!autopilotMode && !approvalMode) {
    return fail("Workspace operating mode and state do not agree; refusing autonomous action.", false);
  }

  const { data: usageReserved, error: usageReserveError } = await supabase.rpc("reserve_draft_usage", {
    p_job_id: job.id,
    p_workspace_id: workspace.id,
    p_period_start: quotaPeriod.periodStart,
    p_period_end: quotaPeriod.periodEnd,
    p_limit: 30,
    p_metric: quotaPeriod.metric,
  });
  if (usageReserveError) return fail("Could not reserve monthly draft usage: " + usageReserveError.message);
  if (!usageReserved) {
    await recordAgentEvent(supabase, workspace.id, "agent_cycle_decision", {
      cycleDate, decision: "no_op", reason: "monthly_draft_limit_reached",
    });
    return { jobId: job.id, success: true, status: "succeeded", retryable: false };
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
      source_notes: "Source: " + opportunity.source + "\nArticle: " + opportunity.url + "\nPublisher: " + opportunity.sourceUrl + "\nPublished: " + opportunity.publishedAt + "\nEvidence: " + opportunity.evidence + (claimCheck.ok ? "" : "\nSelf-check: " + claimCheck.issues.join(" ")),
      status: autopilot ? "approved" : "needs_review",
      scheduled_at: null,
      version: 1,
    })
    .select()
    .single();

  if (postError || !post) {
    // A unique conflict means another execution of this same cycle already
    // created the post. Keep this job's idempotent usage reservation.
    if (postError?.code === "23505") {
      return { jobId: job.id, success: true, status: "succeeded", retryable: false };
    }

    // Release only for explicit database rejections where Postgres confirms
    // the insert did not commit. Network/transport failures are ambiguous:
    // retain the reservation so a retry can recover a possibly-created post.
    const errorCode = typeof postError?.code === "string" ? postError.code : "";
    const definitelyRejected = /^(22|23|42501)/.test(errorCode);
    if (definitelyRejected) {
      const { error: releaseError } = await supabase.rpc("release_draft_usage", {
        p_job_id: job.id,
      });
      if (releaseError) console.error("[agent-cycle] Could not release draft usage reservation:", releaseError.message);
    }
    return fail("Could not save the agent-generated post: " + (postError?.message ?? "unknown or ambiguous database response"));
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

  await recordAgentEvent(supabase, workspace.id, "agent_cycle_decision", {
    cycleDate,
    decision: autopilot ? "queue_autopilot_publish" : "create_review_draft",
    evergreen: isEvergreen,
    selfCheckIssues: claimCheck.issues,
    sentToReviewBecause: autopilotMode && needsHumanReview ? (isEvergreen ? "evergreen_post_has_no_source" : "claims_not_supported_by_source") : undefined,
    reason: isEvergreen ? "No fresh story qualified; drafted an evergreen post for review." : "Fresh evidence matched workspace strategy terms: " + opportunity.matchedKeywords.join(", ") + ".",
    postId: post.id,
    sourceTitle: opportunity.title,
    sourceUrl: opportunity.sourceUrl,
    articleUrl: opportunity.url,
    sourceName: opportunity.source,
    sourcePublishedAt: opportunity.publishedAt,
    retrievedAt: new Date().toISOString(),
    relevanceScore: opportunity.score,
    matchedKeywords: opportunity.matchedKeywords,
    confidence: opportunity.relevance,
    aiProvider: generated.providerUsed,
    aiModel: generated.modelUsed,
    estimatedTokens: generated.estimatedTokens,
    approvalSignals: approvalSummary,
    externalMetricsAvailability: "unavailable_r_member_postAnalytics_not_granted",
  });

  if (autopilot) {
    const outcome = await scheduleAutopilotPost(supabase, workspace, post, browserBinding);
    if (!outcome.ok && outcome.retryable) return fail(outcome.message);
  } else {
    // The draft itself goes out as an image with approve/reject buttons.
    await notifyWorkspaceTelegramDraft(workspace.id, post, { supabase, browser: browserBinding });
  }

  return { jobId: job.id, success: true, status: "succeeded", retryable: false };
}
