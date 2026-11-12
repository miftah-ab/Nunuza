import { createServiceClient } from "@/lib/supabase/server";
import { notifyWorkspaceTelegram } from "@/lib/integrations/telegram/service";
import { decryptSubscriptionValue } from "./subscription-crypto";
import { sendWebPush } from "./web-push";

type Notification = {
  id: string; workspace_id: string; title: string; body: string; href: string;
  priority: "normal" | "high" | "critical"; push_status: string; telegram_status: string;
  push_attempts: number; telegram_attempts: number;
};

function retryAt(attempt: number): string {
  const delay = Math.min(60, 2 ** Math.max(1, attempt)) * 60_000;
  return new Date(Date.now() + delay).toISOString();
}
function escapeTelegramMarkdown(value: string): string {
  const special = new Set(["_", "*", "[", "]", "(", ")", "~", String.fromCharCode(96), ">", "#", "+", "-", "=", "|", "{", "}", ".", "!"]);
  return Array.from(value, (character) => special.has(character) ? "\\" + character : character).join("");
}

async function createUpcomingScheduledNotifications(db: ReturnType<typeof createServiceClient>) {
  const now = new Date();
  const end = new Date(now.getTime() + 30 * 60_000);
  const { data: posts, error } = await db.from("content_posts")
    .select("id,workspace_id,internal_title,scheduled_at")
    .eq("status", "scheduled")
    .gte("scheduled_at", now.toISOString())
    .lte("scheduled_at", end.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(100);
  if (error) {
    console.error("[notifications] Could not inspect upcoming scheduled posts.");
    return;
  }
  for (const post of posts ?? []) {
    await db.rpc("create_notification_event", {
      p_workspace_id: post.workspace_id,
      p_event_key: "post:" + post.id + ":upcoming:" + post.scheduled_at,
      p_category: "publishing",
      p_priority: "high",
      p_title: "Your post is scheduled soon",
      p_body: (post.internal_title || "A LinkedIn post") + " is scheduled to publish within 30 minutes.",
      p_href: "/app/content?post=" + post.id,
    });
  }
}

export async function dispatchPendingNotifications(limit = 50): Promise<{ processed: number; failed: number }> {
  const db = createServiceClient();
  await createUpcomingScheduledNotifications(db);
  const { data: events, error } = await db.rpc("claim_pending_notification_deliveries", { p_limit: limit });
  if (error) throw new Error("Could not claim pending notifications.");
  let processed = 0;
  let failed = 0;

  for (const event of (events ?? []) as Notification[]) {
    const updates: Record<string, unknown> = {};
    const retryAttempts: number[] = [];

    // Routine updates remain in the inbox. Push and Telegram are reserved for
    // time-sensitive or critical events to avoid notification fatigue.
    if (event.priority === "normal") {
      updates.push_status = "skipped";
      updates.telegram_status = "skipped";
    }

    if (event.priority !== "normal" && event.push_status === "pending") {
      const { data: subscriptions, error: subscriptionError } = await db
        .from("web_push_subscriptions")
        .select("id,endpoint_encrypted,p256dh_encrypted,auth_secret_encrypted")
        .eq("workspace_id", event.workspace_id);
      if (subscriptionError) {
        updates.push_attempts = event.push_attempts + 1;
        updates.last_delivery_error = "push_subscription_lookup_failed";
        if (event.push_attempts < 5) retryAttempts.push(event.push_attempts + 1);
        else updates.push_status = "failed";
      } else if (!subscriptions?.length) {
        updates.push_status = "skipped";
      } else {
        let delivered = false;
        let transientFailure = false;
        for (const subscription of subscriptions) {
          try {
            const decrypted = {
              endpoint: await decryptSubscriptionValue(subscription.endpoint_encrypted),
              p256dh: await decryptSubscriptionValue(subscription.p256dh_encrypted),
              auth_secret: await decryptSubscriptionValue(subscription.auth_secret_encrypted),
            };
            const result = await sendWebPush(decrypted, {
              title: event.title, body: event.body, url: event.href,
              notificationId: event.id, tag: event.id,
            });
            if (result.expired) {
              await db.from("web_push_subscriptions").delete().eq("id", subscription.id);
            } else if (result.ok) {
              delivered = true;
              await db.from("web_push_subscriptions")
                .update({ last_success_at: new Date().toISOString() }).eq("id", subscription.id);
            } else transientFailure = true;
          } catch {
            transientFailure = true;
          }
        }
        if (delivered) updates.push_status = "sent";
        else if (transientFailure && event.push_attempts < 5) {
          updates.push_attempts = event.push_attempts + 1;
          retryAttempts.push(event.push_attempts + 1);
          updates.last_delivery_error = "push_delivery_failed";
        } else updates.push_status = "failed";
      }
    }

    if (event.priority !== "normal" && event.telegram_status === "pending") {
      const { data: link, error: linkError } = await db.from("telegram_links")
        .select("chat_id").eq("workspace_id", event.workspace_id).is("revoked_at", null).maybeSingle();
      if (linkError) {
        updates.telegram_attempts = event.telegram_attempts + 1;
        if (event.telegram_attempts < 5) retryAttempts.push(event.telegram_attempts + 1);
        else updates.telegram_status = "failed";
        updates.last_delivery_error = "telegram_link_lookup_failed";
      } else if (!link?.chat_id) {
        updates.telegram_status = "skipped";
      } else {
        const message = "*" + escapeTelegramMarkdown(event.title) + "*\n\n" + escapeTelegramMarkdown(event.body);
        const result = await notifyWorkspaceTelegram(event.workspace_id, { text: message }, db);
        if (result.ok) updates.telegram_status = "sent";
        else if (event.telegram_attempts < 5) {
          updates.telegram_attempts = event.telegram_attempts + 1;
          retryAttempts.push(event.telegram_attempts + 1);
          updates.last_delivery_error = "telegram_delivery_failed";
        } else updates.telegram_status = "failed";
      }
    }

    if (retryAttempts.length) {
      updates.next_attempt_at = retryAt(Math.max(...retryAttempts));
      failed++;
    } else {
      updates.next_attempt_at = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    }

    const { error: updateError } = await db.from("notification_events").update(updates).eq("id", event.id);
    if (updateError) {
      console.error("[notifications] Could not persist delivery state for event", event.id);
      failed++;
    } else processed++;
  }
  return { processed, failed };
}
