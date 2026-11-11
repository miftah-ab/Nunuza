/**
 * Telegram Bot Long-Polling Bridge for Local Development & Realtime Processing.
 *
 * Automatically bridges incoming Telegram updates to the local webhook endpoint:
 * POST http://127.0.0.1:3000/api/webhooks/telegram
 *
 * Runs seamlessly alongside `npm run dev`.
 */

import fs from "fs";
import path from "path";

// Load .env.local if present
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const TARGET_URL = process.env.LOCAL_WEBHOOK_URL || "http://127.0.0.1:3000/api/webhooks/telegram";

if (!BOT_TOKEN) {
  console.error("❌ [telegram-poller] TELEGRAM_BOT_TOKEN is not configured in .env.local");
  process.exit(1);
}

let isRunning = true;
let offset = 0;

process.on("SIGINT", () => {
  console.log("\n[telegram-poller] Stopping...");
  isRunning = false;
  process.exit(0);
});

process.on("SIGTERM", () => {
  isRunning = false;
  process.exit(0);
});

async function init() {
  console.log("🤖 [telegram-poller] Initializing Telegram Polling Engine...");

  // 1. Check getMe
  try {
    const meRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    const meData = await meRes.json();
    if (meData.ok) {
      console.log(`✅ [telegram-poller] Connected to Telegram Bot: @${meData.result.username} (ID: ${meData.result.id})`);
    } else {
      console.error("❌ [telegram-poller] Invalid BOT_TOKEN:", meData.description);
      process.exit(1);
    }
  } catch (err) {
    console.error("❌ [telegram-poller] Network error contacting Telegram:", err.message);
  }

  // 2. Check if active webhook exists
  try {
    const webhookRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
    const webhookData = await webhookRes.json();
    if (webhookData.ok && webhookData.result.url) {
      if (process.argv.includes("--force-delete-webhook")) {
        console.log(`ℹ️ [telegram-poller] Clearing active webhook (${webhookData.result.url}) for local long-polling...`);
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`);
      } else {
        console.log(`✅ [telegram-poller] Active webhook is live on: ${webhookData.result.url}`);
        console.log("ℹ️ Telegram delivers updates serverless directly to your domain. Poller will not override live webhook without --force-delete-webhook.");
        process.exit(0);
      }
    }
  } catch (err) {
    console.warn("⚠️ [telegram-poller] Could not inspect webhook:", err.message);
  }

  console.log(`🚀 [telegram-poller] Listening for Telegram updates... Forwarding to ${TARGET_URL}`);
  poll();
}

async function poll() {
  while (isRunning) {
    try {
      const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset}&timeout=20`;
      const response = await fetch(url);
      const data = await response.json();

      if (!data.ok) {
        if (data.error_code === 409) {
          console.error("[telegram-poller] Polling conflicts with an active webhook. Stopping without changing webhook configuration.");
          isRunning = false;
          break;
        } else {
          console.warn("⚠️ [telegram-poller] getUpdates returned error:", data.description);
        }
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      const updates = data.result || [];
      for (const update of updates) {
        console.log(`[telegram-poller] Forwarding update ${update.update_id}.`);

        // Forward to local Next.js route
        try {
          const webhookRes = await fetch(TARGET_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
            },
            body: JSON.stringify(update),
          });

          if (!webhookRes.ok) {
            console.error(`[telegram-poller] Local webhook returned HTTP ${webhookRes.status}; update will be retried.`);
            break;
          }
          offset = update.update_id + 1;
        } catch (fwdErr) {
          console.error(`[telegram-poller] Failed forwarding update ${update.update_id}; update will be retried:`, fwdErr?.name || "NetworkError");
          break;
        }
      }
    } catch (err) {
      console.warn("⚠️ [telegram-poller] Polling connection error:", err.message);
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
}

init();

