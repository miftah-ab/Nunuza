# Cloudflare production deployment

Nunuza keeps its web dashboard on Vercel and runs scheduled/background work on the Cloudflare Worker named `nunuza`.

## Automated setup

The repository includes **Deploy Nunuza to Cloudflare** at `.github/workflows/cloudflare-production-deploy.yml`. After adding the three GitHub secrets below, run it from **GitHub Actions → Deploy Nunuza to Cloudflare → Run workflow**.

The workflow validates the credentials, builds the Worker, creates both queues if missing, uploads the runtime secrets, and deploys the Worker. You do not need to create queues manually or run Wrangler locally.

## One-time GitHub configuration

Open this repository's **Settings → Secrets and variables → Actions → New repository secret**.

Create these three secrets:

1. `CLOUDFLARE_API_TOKEN` — Cloudflare API token with account-level **Workers Scripts: Edit** and **Queues: Edit** permissions.
2. `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID.
3. `NUNUZA_WORKER_ENV_JSON` — one JSON object containing the application environment values listed below.

The JSON secret must contain these keys. Replace each placeholder with the real production value; do not leave the placeholders in place.

```json
{
  "NEXT_PUBLIC_APP_URL": "https://YOUR-REAL-NU NUZA-DOMAIN",
  "NEXT_PUBLIC_SUPABASE_URL": "https://YOUR-PROJECT.supabase.co",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "YOUR_SUPABASE_PUBLISHABLE_KEY",
  "LINKEDIN_REDIRECT_URI": "YOUR_EXACT_REGISTERED_LINKEDIN_CALLBACK_URL",
  "LINKEDIN_API_VERSION": "YOUR_LINKEDIN_APPROVED_API_VERSION",
  "SUPABASE_SERVICE_ROLE_KEY": "YOUR_SUPABASE_SERVICE_ROLE_KEY",
  "GROQ_API_KEY": "YOUR_GROQ_API_KEY",
  "OPENROUTER_API_KEY": "YOUR_OPENROUTER_API_KEY",
  "LINKEDIN_CLIENT_ID": "YOUR_LINKEDIN_CLIENT_ID",
  "LINKEDIN_CLIENT_SECRET": "YOUR_LINKEDIN_CLIENT_SECRET",
  "LINKEDIN_TOKEN_ENCRYPTION_KEY": "64_HEX_CHARACTERS",
  "TELEGRAM_BOT_TOKEN": "YOUR_TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET": "YOUR_TELEGRAM_WEBHOOK_SECRET",
  "POLAR_ACCESS_TOKEN": "YOUR_LIVE_POLAR_ACCESS_TOKEN",
  "POLAR_WEBHOOK_SECRET": "YOUR_LIVE_POLAR_WEBHOOK_SECRET",
  "POLAR_PRODUCT_ID": "YOUR_LIVE_POLAR_PRODUCT_ID",
  "POLAR_PRICE_ID": "YOUR_LIVE_POLAR_PRICE_ID",
  "WEB_PUSH_VAPID_PUBLIC_KEY": "YOUR_VAPID_PUBLIC_KEY",
  "WEB_PUSH_VAPID_PRIVATE_KEY": "YOUR_VAPID_PRIVATE_KEY",
  "WEB_PUSH_VAPID_SUBJECT": "mailto:YOUR-OPERATIONS-EMAIL",
  "WEB_PUSH_SUBSCRIPTION_ENCRYPTION_KEY": "64_HEX_CHARACTERS"
}
```

Both encryption keys must be exactly 64 hexadecimal characters (32 bytes). Use the actual production LinkedIn callback URL registered in your LinkedIn developer app. Use live Polar credentials only if live payments are enabled.

**Important limitation:** Vercel does not expose Production Secret values through `vercel env pull`. Existing Vercel secrets cannot be silently copied into Cloudflare by automation. You must obtain the original values from the providers/password manager and place them in the single JSON secret. Do not paste them into chat or commit this JSON to the repository.

## Run deployment

1. Add the three GitHub repository secrets.
2. Open **Actions → Deploy Nunuza to Cloudflare**.
3. Click **Run workflow** on the default branch.
4. Wait for a successful run.

The workflow provisions `nunuza-agent-jobs-dlq` and `nunuza-agent-jobs`, uploads Worker secrets, and deploys the Worker using the queue bindings and Cron configuration in `wrangler.jsonc`.

## Production verification

After deployment, verify:
- Worker `nunuza` is active.
- Cron Triggers run every minute and every five minutes.
- Queue producer/consumer uses `nunuza-agent-jobs`; dead-letter queue is `nunuza-agent-jobs-dlq`.
- Worker logs show successful scheduled ticks without logging secrets.
- A scheduled test post on a test LinkedIn account publishes exactly once and reaches its expected terminal job state.
- Cancellation, rescheduling, transient retries, duplicate queue delivery, and notification delivery work correctly.

Do not enable unattended publishing until these checks pass.

## Architecture and safety

- Vercel hosts the dashboard/API; Cloudflare Worker owns scheduled and queue execution. Do not run the same scheduler on both platforms.
- Supabase is the source of truth for job state. Queue delivery is at-least-once; database claim/lease logic is the idempotency boundary.
- R2 is not required by this Worker configuration. Do not create an R2 bucket or add R2 credentials unless a separate feature explicitly uses object storage.
- The Cloudflare deployment token is used by GitHub Actions only. It is not an application runtime secret.
