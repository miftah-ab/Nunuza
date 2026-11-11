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
  let parsedUrl;
  try {
    parsedUrl = new URL(webhookUrl);
  } catch {
    throw new Error("Webhook URL must be a valid HTTPS URL.");
  }
  if (parsedUrl.protocol !== "https:") {
    throw new Error("Telegram production webhooks require HTTPS.");
  }
  if (!WEBHOOK_SECRET || WEBHOOK_SECRET.length < 32) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET must be configured with at least 32 characters before setting the webhook.");
  }

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl, secret_token: WEBHOOK_SECRET }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.description || `Telegram returned HTTP ${res.status}.`);
  console.log("Webhook configured successfully.");
}

run().catch(console.error);

