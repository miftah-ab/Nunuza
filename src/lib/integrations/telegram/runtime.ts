/**
 * Access to the Cloudflare Worker runtime for Telegram draft images.
 *
 * The draft image is a screenshot rendered by the Browser Rendering binding
 * (`BROWSER` in wrangler.jsonc). The queue consumer receives that binding
 * directly, but web routes (dashboard draft generation, MCP, the Telegram
 * webhook) only reach it through OpenNext's request context. Outside Workers
 * (tests, `next dev`) there is no context, so every helper here degrades to
 * "no binding" instead of throwing.
 */

export interface TelegramBrowserBinding {
  quickAction(
    action: "screenshot",
    options: {
      url: string;
      viewport?: { width: number; height: number; deviceScaleFactor?: number };
      screenshotOptions?: { fullPage?: boolean };
      gotoOptions?: { waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2"; timeout?: number };
      /** Take the screenshot even if navigation or waiting times out. */
      bestAttempt?: boolean;
    }
  ): Promise<Response>;
}

async function readCloudflareContext(): Promise<{ env: any; ctx: any } | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const context = getCloudflareContext();
    return context ? { env: context.env, ctx: context.ctx } : null;
  } catch {
    return null;
  }
}

/** The Browser Rendering binding of the current Worker request, if any. */
export async function getRequestBrowserBinding(): Promise<TelegramBrowserBinding | undefined> {
  const context = await readCloudflareContext();
  const browser = context?.env?.BROWSER;
  return browser && typeof browser.quickAction === "function" ? browser : undefined;
}

/**
 * Keeps a notification alive after the HTTP response has been sent. A Worker
 * cancels un-awaited work when the response returns unless it is registered
 * with `waitUntil`, which is why fire-and-forget notifications could go
 * missing. Never throws; delivery problems are logged by the callee.
 */
export async function runAfterResponse(work: Promise<unknown>): Promise<void> {
  const guarded = work.catch(() => {});
  const context = await readCloudflareContext();
  try {
    context?.ctx?.waitUntil?.(guarded);
  } catch {
    // Not running on Workers: the promise still runs, it just is not tracked.
  }
}
