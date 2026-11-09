/**
 * Sets or inspects the Telegram webhook URL for production deployments.
 *
 * Usage:
 *   node scripts/setup-telegram-webhook.mjs https://your-domain.com/api/webhooks/telegram
 *   node scripts/setup-telegram-webhook.mjs --status
 *   node scripts/setup-telegram-webhook.mjs --delete
 */

import fs from "fs";
import path from "path";

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
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN not configured");
  process.exit(1);
}

const arg = process.argv[2];

async function run() {
  if (arg === "--status" || !arg) {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
    const data = await res.json();
    console.log("📡 Current Webhook Info:", JSON.stringify(data, null, 2));
    return;
  }

  if (arg === "--delete") {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`);
    const data = await res.json();
    console.log("🗑️ Webhook Deleted:", data);
    return;
  }

  const webhookUrl = arg;
  console.log(`Setting webhook to: ${webhookUrl}`);
  const url = new URL(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`);
  url.searchParams.set("url", webhookUrl);
  if (WEBHOOK_SECRET) {
    url.searchParams.set("secret_token", WEBHOOK_SECRET);
  }

  const res = await fetch(url.toString());
  const data = await res.json();
  console.log("✅ Webhook Result:", data);
}

run().catch(console.error);

