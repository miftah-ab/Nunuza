# Cloudflare production deployment

Nunuza keeps its web dashboard on Vercel and runs scheduled/background work on the Cloudflare Worker named `nunuza`.

## Automated setup

The repository now includes **Deploy Nunuza to Cloudflare** at `.github/workflows/cloudflare-production-deploy.yml`. Once the GitHub Actions values below are configured, run it from GitHub Actions → Deploy Nunuza to Cloudflare → Run workflow.

The workflow:
1. Validates required credentials and encryption-key formats.
2. Builds the OpenNext Cloudflare Worker.
3. Creates the two Cloudflare Queues if they do not already exist.
4. Uploads runtime secrets to the Worker.
5. Deploys the Worker with the production variables and bindings in `wrangler.jsonc`.

It is intentionally manual at first. Do not enable unattended publishing until the live checks below pass.

## One-time GitHub configuration

In GitHub, open **Settings → Secrets and variables → Actions** for this repository.

Add these **Repository secrets**:

- `CLOUDFLARE_API_TOKEN` — Cloudflare API token with account-level Workers Scripts:Edit and Queues:Edit permissions.
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GROQ_API_KEY`
- `OPENROUTER_API_KEY`
- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- `LINKEDIN_TOKEN_ENCRYPTION_KEY` — exactly 64 hexadecimal characters (32 bytes).
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `POLAR_ACCESS_TOKEN`
- `POLAR_WEBHOOK_SECRET`
- `POLAR_PRODUCT_ID`
- `POLAR_PRICE_ID`
- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`
- `WEB_PUSH_SUBSCRIPTION_ENCRYPTION_KEY` — exactly 64 hexadecimal characters (32 bytes).

Add these **Repository variables**:

- `NUNUZA_APP_URL` — exact production Vercel URL.
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL.
- `LINKEDIN_REDIRECT_URI` — exact callback URL registered in the LinkedIn app.
- `LINKEDIN_API_VERSION` — API version approved for the LinkedIn app.
- `WEB_PUSH_VAPID_SUBJECT` — normally a `mailto:` contact URI.

Only add credentials for integrations enabled in production, but every value marked required by the workflow must be present for deployment. Never put secrets in repository files, commit history, or chat.

## Run deployment

1. Open **Actions → Deploy Nunuza to Cloudflare**.
2. Select **Run workflow** on the default branch.
3. Wait for the workflow to finish successfully.

It provisions queues named `nunuza-agent-jobs` and `nunuza-agent-jobs-dlq`, uploads the runtime secrets, and deploys the Worker. You do not need to create queues manually or run Wrangler locally.

## Verify production before enabling autonomous publishing

- Worker `nunuza` is active.
- Both Cron Triggers are present: every minute and every five minutes.
- Queue producer/consumer binding points to `nunuza-agent-jobs`; its dead-letter queue is `nunuza-agent-jobs-dlq`.
- Logs show successful scheduled ticks without exposing credentials.
- A scheduled test post on a test LinkedIn account publishes once, reaches its expected terminal job state, and sends its notification.
- Cancel-before-due, edit/reschedule, transient retry, and duplicate queue delivery all behave correctly.

## Architecture and safety

- Vercel hosts the dashboard/API; Cloudflare Worker owns scheduled and queue execution. Do not run the same scheduler in both platforms.
- Supabase is the source of truth for job state. Queue delivery is at-least-once; database claim/lease logic is the idempotency boundary.
- R2 is not required by this Worker configuration. Do not create an R2 bucket or add R2 credentials unless a separate feature explicitly uses object storage.
- The deployment token is used by GitHub Actions only. It is not an application runtime secret.
