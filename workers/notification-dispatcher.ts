interface Env {
  APP_URL: string;
  CRON_SECRET?: string;
}

async function dispatchNotifications(env: Env): Promise<void> {
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 32) {
    console.error("[nunuza-notification-cron] CRON_SECRET is missing or invalid.");
    return;
  }

  let endpoint: URL;
  try {
    endpoint = new URL("/api/internal/notifications/dispatch", env.APP_URL);
    if (endpoint.protocol !== "https:") throw new Error("HTTPS is required.");
  } catch {
    console.error("[nunuza-notification-cron] APP_URL must be a valid HTTPS URL.");
    return;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CRON_SECRET}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(55_000),
    });

    if (!response.ok) {
      console.error("[nunuza-notification-cron] Dispatch endpoint returned HTTP", response.status);
      return;
    }

    const result = await response.json() as { processed?: number; failed?: number };
    console.info(
      "[nunuza-notification-cron] Delivery pass completed.",
      "processed:", Number(result.processed ?? 0),
      "failed:", Number(result.failed ?? 0)
    );
  } catch (error) {
    console.error(
      "[nunuza-notification-cron] Could not reach the dispatch endpoint.",
      error instanceof Error ? error.name : "UnknownError"
    );
  }
}

export default {
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(dispatchNotifications(env));
  },
} satisfies ExportedHandler<Env>;
