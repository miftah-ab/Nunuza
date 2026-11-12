import crypto from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { decryptToken } from "@/lib/integrations/linkedin/crypto";
import { aiService } from "@/lib/ai/service";
import { assertVoiceConstraints, VoiceConstraintError } from "@/lib/ai/voice-constraints";
import { assertNoExcludedPhrase, StrategyExclusionError } from "@/lib/ai/exclusions";
import { LINKEDIN_API_VERSION } from "@/lib/integrations/linkedin/client";
import { notifyWorkspaceTelegram } from "@/lib/integrations/telegram/service";

export const ENGAGEMENT_READ_SCOPE = "r_member_social_feed";
export const ENGAGEMENT_WRITE_SCOPE = "w_member_social_feed";

export type EngagementScanResult = {
  scannedPosts: number;
  newComments: number;
  draftsCreated: number;
  ignored: number;
  unavailableReason?: string;
};

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}
function safeUrn(value: unknown): value is string {
  return typeof value === "string" && /^urn:li:(activity|share|ugcPost):[A-Za-z0-9:(),_-]+$/.test(value);
}
function textFromComment(comment: any): string {
  const value = comment?.message?.text ?? comment?.commentary ?? "";
  return typeof value === "string" ? value.trim().slice(0, 3000) : "";
}
function commentUrn(comment: any, postUrn: string): string | null {
  if (typeof comment?.commentUrn === "string" && comment.commentUrn.startsWith("urn:li:comment:")) return comment.commentUrn;
  const id = comment?.id;
  if (typeof id === "string" && /^[0-9]+$/.test(id)) return `urn:li:comment:(${postUrn},${id})`;
  return null;
}
function isLowValue(text: string): boolean {
  const value = text.toLocaleLowerCase().trim();
  if (value.length < 8) return true;
  if (/^(great|nice|thanks|congrats|well said|agree|following|dm me|check my profile)[!.\s]*$/i.test(value)) return true;
  if (/\b(crypto giveaway|whatsapp me|telegram me|investment opportunity|earn money fast|click my link)\b/i.test(value)) return true;
  return false;
}
function isWorthReplying(text: string): boolean {
  return text.includes("?") ||
    /\b(how|why|what|when|where|which|could you|can you|disagree|however|i think|in my experience|not sure|but)\b/i.test(text);
}

async function linkedinRequest(token: string, path: string, extraHeaders: Record<string, string> = {}): Promise<any> {
  const response = await fetch(`https://api.linkedin.com/rest/${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "LinkedIn-Version": LINKEDIN_API_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
      ...extraHeaders,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("LINKEDIN_ENGAGEMENT_ACCESS_DENIED");
  }
  if (response.status === 429) throw new Error("LINKEDIN_ENGAGEMENT_RATE_LIMITED");
  if (!response.ok) throw new Error(`LINKEDIN_ENGAGEMENT_HTTP_${response.status}`);
  return response.json();
}

/**
 * Monitor comments on posts Nunuza itself published. This uses only the official
 * Comments API and only when LinkedIn actually granted the restricted read scope.
 * External-post discovery is deliberately not fabricated here: LinkedIn does not
 * expose a general member-feed search endpoint to this app's current product grant.
 */
export async function scanOwnPostComments(
  workspaceId: string,
  options: { supabaseOverride?: any; maxPosts?: number } = {}
): Promise<EngagementScanResult> {
  const db = options.supabaseOverride || createServiceClient();
  const { data: connection, error: connectionError } = await db
    .from("integration_connections")
    .select("status,expires_at,granted_scopes,encrypted_token_ref,external_account_id")
    .eq("workspace_id", workspaceId)
    .eq("provider", "linkedin")
    .maybeSingle();

  if (connectionError || !connection || connection.status !== "connected" || !connection.encrypted_token_ref) {
    return { scannedPosts: 0, newComments: 0, draftsCreated: 0, ignored: 0, unavailableReason: "linkedin_not_connected" };
  }
  const scopes = Array.isArray(connection.granted_scopes) ? connection.granted_scopes : [];
  if (!scopes.includes(ENGAGEMENT_READ_SCOPE)) {
    return { scannedPosts: 0, newComments: 0, draftsCreated: 0, ignored: 0, unavailableReason: "linkedin_comment_read_permission_not_granted" };
  }
  if (connection.expires_at && Date.parse(connection.expires_at) <= Date.now()) {
    return { scannedPosts: 0, newComments: 0, draftsCreated: 0, ignored: 0, unavailableReason: "linkedin_connection_expired" };
  }

  const token = decryptToken(connection.encrypted_token_ref);
  const memberUrn = connection.external_account_id;
  if (typeof memberUrn !== "string" || !memberUrn.startsWith("urn:li:person:")) {
    return { scannedPosts: 0, newComments: 0, draftsCreated: 0, ignored: 0, unavailableReason: "linkedin_member_identity_missing" };
  }
  const maxPosts = Math.min(Math.max(options.maxPosts ?? 50, 1), 100);
  const [localResult, remoteResult] = await Promise.all([
    db.from("content_posts").select("id,linkedin_post_id,text,internal_title")
      .eq("workspace_id", workspaceId).eq("status", "published")
      .not("linkedin_post_id", "is", null).order("published_at", { ascending: false }).limit(maxPosts),
    linkedinRequest(token, `posts?author=${encodeURIComponent(memberUrn)}&q=author&count=${maxPosts}&sortBy=LAST_MODIFIED`, {
      "X-RestLi-Method": "FINDER",
    }),
  ]);
  if (localResult.error) throw new Error("Could not load published LinkedIn posts for engagement monitoring.");
  const localByUrn = new Map<string, any>((localResult.data ?? []).map((post: any) => [String(post.linkedin_post_id), post] as const));
  const remotePosts = Array.isArray(remoteResult?.elements) ? remoteResult.elements : [];
  const posts = remotePosts
    .filter((post: any) => post.lifecycleState === "PUBLISHED" && safeUrn(post.id))
    .map((post: any) => ({
      id: localByUrn.get(post.id)?.id ?? null,
      linkedin_post_id: post.id,
      text: typeof post.commentary === "string" ? post.commentary : localByUrn.get(post.id)?.text ?? "",
      internal_title: localByUrn.get(post.id)?.internal_title ?? "LinkedIn post",
    }));
  for (const localPost of localResult.data ?? []) {
    if (safeUrn(localPost.linkedin_post_id) && !posts.some((post: any) => post.linkedin_post_id === localPost.linkedin_post_id)) {
      posts.push(localPost);
    }
  }
  posts.splice(maxPosts);

  const [{ data: strategy }, { data: voice }] = await Promise.all([
    db.from("content_strategies").select("*").eq("workspace_id", workspaceId).maybeSingle(),
    db.from("voice_profiles").select("*").eq("workspace_id", workspaceId).maybeSingle(),
  ]);

  let newComments = 0, draftsCreated = 0, ignored = 0, scannedPosts = 0;
  for (const post of posts ?? []) {
    if (!safeUrn(post.linkedin_post_id)) continue;
    const encodedUrn = encodeURIComponent(post.linkedin_post_id);
    const result = await linkedinRequest(token, `socialActions/${encodedUrn}/comments?count=50&start=0`);
    const comments = Array.isArray(result?.elements) ? result.elements : [];
    scannedPosts++;

    for (const comment of comments) {
      const text = textFromComment(comment);
      const urn = commentUrn(comment, post.linkedin_post_id);
      const actor = typeof comment?.actor === "string" ? comment.actor : null;
      if (!text || !urn || (actor && actor === memberUrn)) continue;

      const { data: existing } = await db.from("engagement_actions")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("provider", "linkedin")
        .eq("source_comment_urn", urn)
        .maybeSingle();
      if (existing) continue;
      newComments++;

      if (isLowValue(text) || !isWorthReplying(text)) {
        await db.from("engagement_actions").insert({
          workspace_id: workspaceId, action_type: "reply", target_kind: "own_post_comment",
          provider: "linkedin", target_post_urn: post.linkedin_post_id,
          parent_post_urn: post.linkedin_post_id, parent_comment_urn: urn,
          source_comment_urn: urn, source_author_urn: actor, source_text: text,
          draft_text: "Ignored by relevance triage.", draft_hash: sha256("ignored:" + urn),
          status: "ignored", metadata: { reason: isLowValue(text) ? "low_value_or_spam" : "no_reply_needed" },
        });
        ignored++;
        continue;
      }

      const generated = await aiService.generateDraft({
        topic: "Write a concise LinkedIn reply to a comment on the user's own post.",
        targetLength: "short",
        notes: [
          "You are replying as the LinkedIn post author. This is a comment reply, not a new post.",
          "Original post title: " + String(post.internal_title ?? ""),
          "Original post text: " + String(post.text ?? "").slice(0, 1800),
          "Comment to reply to: " + text,
          "Use the saved audience, goals, content pillars and voice below.",
          "Audience: " + JSON.stringify(strategy?.audience ?? {}),
          "Goals: " + JSON.stringify(strategy?.goals ?? []),
          "Pillars: " + JSON.stringify(strategy?.pillars ?? []),
          "Voice: " + JSON.stringify(voice ?? {}),
          "Do not invent facts. Answer genuine questions directly. For disagreement, be respectful and substantive. If the comment is hostile, sensitive, legal, medical, or asks for private information, return a short neutral acknowledgement and flag for manual handling.",
          "Return only the reply text. Maximum 700 characters. No hashtags. No generic praise.",
        ].join("\n"),
        strategy: {
          audience: strategy?.audience ?? {},
          goals: strategy?.goals ?? [],
          pillars: strategy?.pillars ?? [],
          exclusions: strategy?.exclusions ?? [],
        },
        voiceProfile: voice ? {
          tone: voice.tone, sentenceLength: voice.sentence_length, formality: voice.formality,
          phrasesUse: voice.phrases_use, phrasesAvoid: voice.phrases_avoid,
          sampleText: voice.sample_text, exclusions: voice.exclusions,
        } : undefined,
        companyName: undefined,
      });
      const draft = generated.text.trim().slice(0, 700);
      if (!draft || generated.providerUsed === "mock_deterministic") {
        ignored++;
        continue;
      }
      try {
        assertVoiceConstraints(draft, { phrasesAvoid: voice?.phrases_avoid, exclusions: voice?.exclusions });
        assertNoExcludedPhrase(draft, [
          ...(Array.isArray(strategy?.exclusions) ? strategy.exclusions : []),
          ...(Array.isArray(voice?.exclusions) ? voice.exclusions : []),
          ...(Array.isArray(voice?.phrases_avoid) ? voice.phrases_avoid : []),
        ], "reply");
      } catch (err) {
        if (err instanceof VoiceConstraintError || err instanceof StrategyExclusionError) {
          ignored++;
          continue;
        }
        throw err;
      }

      const draftHash = sha256(draft);
      const { data: action, error: insertError } = await db.from("engagement_actions").insert({
        workspace_id: workspaceId, action_type: "reply", target_kind: "own_post_comment",
        provider: "linkedin", target_post_urn: post.linkedin_post_id,
        parent_post_urn: post.linkedin_post_id, parent_comment_urn: urn,
        source_comment_urn: urn, source_author_urn: actor, source_text: text,
        draft_text: draft, draft_hash: draftHash, status: "awaiting_approval",
        metadata: { aiProvider: generated.providerUsed, aiModel: generated.modelUsed, postId: post.id },
      }).select("id").single();

      if (insertError) {
        if (insertError.code === "23505") continue;
        throw new Error("Could not persist engagement reply draft.");
      }
      draftsCreated++;
      const title = "A LinkedIn comment deserves a reply";
      const body = "Nunuza drafted a response to a comment on your post. Review it before anything is published.";
      const { error: notificationError } = await db.rpc("create_notification_event", {
        p_workspace_id: workspaceId,
        p_event_key: "engagement:" + action.id,
        p_category: "approval",
        p_priority: "high",
        p_title: title,
        p_body: body,
        p_href: "/app/engagement",
      });
      if (notificationError) console.error("[engagement] Notification event could not be created:", notificationError.code);
      await notifyWorkspaceTelegram(workspaceId, {
        text: "A LinkedIn comment deserves a reply. Nunuza drafted a response. Nothing will be posted until you approve it.",
        replyMarkup: {
          inline_keyboard: [[
            { text: "Approve reply", callback_data: "eng:approve:" + action.id + ":" + draftHash.slice(0, 15) },
            { text: "Reject", callback_data: "eng:reject:" + action.id + ":" + draftHash.slice(0, 15) },
          ]],
        },
      }, db);
    }
  }
  return { scannedPosts, newComments, draftsCreated, ignored };
}


/** Queue periodic scans only for connected workspaces with the restricted read scope. */
export async function enqueueEngagementScans(dbOverride?: any): Promise<number> {
  const db = dbOverride || createServiceClient();
  const { data: connections, error } = await db.from("integration_connections")
    .select("workspace_id,granted_scopes,status,expires_at")
    .eq("provider", "linkedin").eq("status", "connected");
  if (error) throw new Error("Could not inspect LinkedIn connections for engagement scans.");
  const eligible = (connections ?? []).filter((c: any) =>
    Array.isArray(c.granted_scopes) && c.granted_scopes.includes(ENGAGEMENT_READ_SCOPE) &&
    (!c.expires_at || Date.parse(c.expires_at) > Date.now())
  );
  if (!eligible.length) return 0;
  const { data: workspaces, error: workspaceError } = await db.from("workspaces")
    .select("id,state,paused_at").in("id", eligible.map((c: any) => c.workspace_id));
  if (workspaceError) throw new Error("Could not load engagement scan workspaces.");
  const active = (workspaces ?? []).filter((w: any) => !w.paused_at && w.state !== "paused");
  const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
  let queued = 0;
  for (const workspace of active) {
    const key = "engagement-scan-" + workspace.id + "-" + bucket;
    const { error: insertError } = await db.from("agent_jobs").insert({
      workspace_id: workspace.id, job_type: "engagement_scan", status: "queued",
      idempotency_key: key, payload: { workspaceId: workspace.id },
      scheduled_for: new Date().toISOString(), attempt_count: 0, max_attempts: 3,
    });
    if (!insertError) queued++;
    else if (insertError.code !== "23505") throw new Error("Could not queue an engagement scan.");
  }
  return queued;
}
