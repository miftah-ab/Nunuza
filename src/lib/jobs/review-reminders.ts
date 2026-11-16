/**
 * Approval mode must not stall silently. A draft that has waited for review
 * for a day gets ONE reminder in Telegram (the draft image with the same
 * buttons). Reminders are recorded in audit_events so a draft is never nagged
 * twice, and each pass sends only a few.
 */
import { createServiceClient } from "@/lib/supabase/server";
import { notifyWorkspaceTelegramDraft, type TelegramBrowserBinding } from "@/lib/integrations/telegram/service";

const REMIND_AFTER_MS = 24 * 60 * 60 * 1000;
const GIVE_UP_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_REMINDERS_PER_PASS = 3;

export async function sendReviewReminders(
  options: { supabase?: any; browser?: TelegramBrowserBinding; now?: Date } = {}
): Promise<{ reminded: number }> {
  const supabase = options.supabase || createServiceClient();
  const now = (options.now ?? new Date()).getTime();
  const { data: posts, error } = await supabase
    .from("content_posts")
    .select("id, workspace_id, internal_title, text, created_at")
    .eq("status", "needs_review")
    .not("agent_cycle_key", "is", null)
    .lt("created_at", new Date(now - REMIND_AFTER_MS).toISOString())
    .gt("created_at", new Date(now - GIVE_UP_AFTER_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(25);
  if (error || !posts?.length) return { reminded: 0 };

  const { data: sent } = await supabase
    .from("audit_events")
    .select("resource_id")
    .eq("action", "review_reminder_sent")
    .in("resource_id", posts.map((post: any) => post.id));
  const alreadyReminded = new Set((sent ?? []).map((row: any) => row.resource_id));

  let reminded = 0;
  for (const post of posts) {
    if (reminded >= MAX_REMINDERS_PER_PASS) break;
    if (alreadyReminded.has(post.id)) continue;
    // Record first: a lost reminder is better than a repeated one.
    const { error: recordError } = await supabase.from("audit_events").insert({
      workspace_id: post.workspace_id, actor_type: "system", action: "review_reminder_sent",
      resource_type: "content_post", resource_id: post.id, safe_metadata: {},
    });
    if (recordError) continue;
    const delivery = await notifyWorkspaceTelegramDraft(post.workspace_id, post, { supabase, browser: options.browser, revised: false });
    if (delivery.ok) reminded += 1;
  }
  return { reminded };
}
