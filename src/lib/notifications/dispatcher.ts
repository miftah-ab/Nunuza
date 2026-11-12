import { createServiceClient } from "@/lib/supabase/server";
import { notifyWorkspaceTelegram } from "@/lib/integrations/telegram/service";
import { sendWebPush } from "./web-push";

type Notification = {
  id: string; workspace_id: string; title: string; body: string; href: string;
  push_status: string; telegram_status: string; push_attempts: number; telegram_attempts: number;
};

function retryAt(attempt: number): string {
  const delay = Math.min(60, 2 ** Math.max(1, attempt)) * 60_000;
  return new Date(Date.now() + delay).toISOString();
}
function escapeTelegramMarkdown(value: string): string {
  const special = new Set(["_", "*", "[", "]", "(", ")", "~", String.fromCharCode(96), ">", "#", "+", "-", "=", "|", "{", "}", ".", "!"]);
  return Array.from(value, (character) => special.has(character) ? "\\" + character : character).join("");
}

export async function dispatchPendingNotifications(limit = 50): Promise<{ processed: number; failed: number }> {
  const db = createServiceClient();
  const { data: events, error } = await db.rpc("claim_pending_notification_deliveries", { p_limit: limit });
  if (error) throw new Error("Could not claim pending notifications.");
  let processed = 0;
  let failed = 0;

  for (const event of (events ?? []) as Notification[]) {
    const updates: Record<string, unknown> = {};
    const retryAttempts: number[] = [];

    if (event.push_status === "pending") {
      const { data: subscriptions, error: subscriptionError } = await db
        .from("web_push_subscriptions")
        .select("id,endpoint,p256dh,auth_secret")
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
            const result = await sendWebPush(subscription, {
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

    if (event.telegram_status === "pending") {
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
