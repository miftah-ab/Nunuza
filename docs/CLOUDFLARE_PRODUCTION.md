# Cloudflare Worker production setup

Nunuza uses Vercel for the web dashboard and this Cloudflare Worker for scheduled/background execution. The Worker entry point is `src/worker.ts`; it wraps the OpenNext-generated Next.js handler and adds Cron + Queue handlers.

## One-time Cloudflare resources

Run from the repository root with Wrangler authenticated to the intended Cloudflare account:

```bash
npx wrangler login
npx wrangler queues create nunuza-agent-jobs-dlq
npx wrangler queues create nunuza-agent-jobs
```

The queue names must exactly match `wrangler.jsonc`. Create each queue only once per account.

## Runtime variables and secrets

Set these on the `nunuza` Worker in the Cloudflare dashboard (Settings → Variables and Secrets), or use `npx wrangler secret put NAME` for secret values.

**Plain-text variables (not secrets):**
- `NEXT_PUBLIC_APP_ENV=production`
- `NEXT_PUBLIC_APP_URL` — the real production URL for the Nunuza web app.
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — Supabase publishable/anon key.
- `LINKEDIN_REDIRECT_URI` — exact production OAuth callback URL registered in LinkedIn.
- `LINKEDIN_API_VERSION` — use the version currently approved for the LinkedIn app.

**Secrets:**
- `SUPABASE_SERVICE_ROLE_KEY`
- `GROQ_API_KEY`
- `OPENROUTER_API_KEY`
- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- `LINKEDIN_TOKEN_ENCRYPTION_KEY` — 32-byte key encoded as 64 hexadecimal characters.
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `POLAR_ACCESS_TOKEN`
- `POLAR_WEBHOOK_SECRET`
- `POLAR_PRODUCT_ID`
- `POLAR_PRICE_ID`
- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`
- `WEB_PUSH_VAPID_SUBJECT`
- `WEB_PUSH_SUBSCRIPTION_ENCRYPTION_KEY` — 32-byte key encoded as 64 hexadecimal characters.

If Workers AI image generation is used, also configure `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` as secrets. These are runtime AI credentials; they are not the Wrangler deployment token.

Do not commit secrets or paste them into chat. The application currently validates several integrations centrally, so configure the values required by enabled production features before accepting production traffic. Do not use test/sandbox Polar credentials for live checkout.

## Build and deploy

Use a local production build with the correct public build-time values available in the shell or a local ignored env file:

```bash
npm ci
npm run wrangler:build
npx wrangler deploy
```

The Worker deployment requires a Cloudflare API token with Workers Scripts edit and Queues edit permissions, plus account access. Keep that deployment token in your local Wrangler authentication or CI secret store; do not add it as an application runtime secret unless a separate automation needs it.

## Verify before enabling real publishing

1. Confirm the deployed Worker is named `nunuza` and the latest version is active.
2. Confirm both Cron Triggers are present: every minute and every five minutes.
3. Confirm the `AGENT_JOBS_QUEUE` producer binding and queue consumer point to `nunuza-agent-jobs`, with `nunuza-agent-jobs-dlq` configured as its dead-letter queue.
4. Confirm required runtime variables/secrets exist without exposing their values in logs.
5. Check Worker observability/logs for successful one-minute notification ticks and five-minute autonomous-cycle ticks.
6. Schedule a test post on a connected test LinkedIn account a few minutes in the future. Verify it publishes once, the job reaches its expected terminal state, and the notification is delivered.
7. Test cancel-before-due, edit/reschedule, transient failure/retry, and duplicate queue delivery. Do not enable unattended production publishing until all pass.

## Operational notes

- Supabase remains the source of truth for job state. Queue messages are delivery signals, not the authoritative job record.
- Queue delivery is at-least-once. The database claim/lease logic must remain the idempotency boundary.
- If queue dispatch fails after a job is claimed, the lease/reconciliation path recovers it; do not add an immediate unguarded inline fallback.
- Vercel and Cloudflare must not both run the same scheduler. Keep scheduled execution on this Worker unless the architecture is deliberately migrated.
