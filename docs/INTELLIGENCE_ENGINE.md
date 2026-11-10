# Nunuza Intelligence Engine

## Current operating cycle

The existing Cloudflare Cron Trigger enqueues at most one agent_cycle job per workspace per UTC day. It uses the existing agent_jobs queue and runner; it does not introduce another scheduler. Active queued, running, or retryable cycles block a new cycle for that workspace, including across a UTC date boundary.

Each cycle reads the workspace strategy, audience, goals, pillars, voice profile, recent post history, approval decisions, and edit history. It queries Google News RSS using strategy keywords, keeps only fresh HTTPS items with a publisher and a non-trivial evidence excerpt, scores relevance against both headlines and evidence, applies strategy and voice exclusions, discounts rejected-topic matches, boosts approved-topic matches, and avoids near-duplicate recent posts.

Research metadata and the evidence excerpt are stored in workspace-scoped audit events. The generated post retains the source, article link, publisher link, publication time, and excerpt in source_notes. Retrieved source text is untrusted: it is passed as evidence, never as instructions.

## Worker execution guarantees

- Jobs are claimed by the PostgreSQL `claim_due_agent_jobs` RPC using row locks and `SKIP LOCKED`; attempts increment only on a successful claim.
- A running attempt starts with a 15-minute lease and renews it every four minutes while its handler is active. Renewal is fenced by job ID, attempt number, and exact prior lease; stale attempts cannot renew or finalize a newer claim.
- Job state transitions compare status and, for claimed executions, the attempt number and lease token. Stale-job recovery uses the same fence.
- If a publish job loses its lease after the post enters `publishing`, it is moved to human reconciliation rather than retried. A post already persisted as published with a LinkedIn URN is recovered as succeeded without another API call.
- A periodic repair reconciles a post left in `publishing` when its job is already in `needs_reconciliation`, covering a partial database failure between those writes.

## Actions and safety

- Approval-required workspaces receive a needs_review post and a Telegram notification. Approval and rejection actions are recorded in the existing approval_events table.
- Autopilot requires explicit autopilot operating mode and active_autopilot state, an unpaused workspace, and one of the current entitlements (internal_beta, paid_trial, paid_active). Migration 0011 maps legacy publishing_beta workspaces to internal_beta but resets them to approval_required, so the migration cannot silently enable Autopilot; legacy internal_test is downgraded to draft_only, moved to commercial access mode, and paused. A connected non-expired LinkedIn connection with w_member_social and the existing publishing worker's final entitlement and cap checks are required.
- The worker checks autopilot state again immediately before publishing an agent-created autopilot job.
- A missing or ambiguous LinkedIn publication ID is never fabricated or blindly retried. Existing manual reconciliation remains authoritative.

## Learning

The first learning pass uses the previous 90 days of approval/rejection decisions and user-edit version snapshots. Approved and rejected title/pillar terms influence later opportunity ranking. User edits are tracked separately from approval outcomes; the engine does not infer audience performance from them.

## LinkedIn analytics limitation

The official LinkedIn Member Post Statistics API exposes impressions, members reached, reactions, comments, and reshares through GET /rest/memberCreatorPostAnalytics. It requires the r_member_postAnalytics permission from LinkedIn's Community Management API. The current Nunuza OAuth connection requests w_member_social plus OpenID Connect identity scopes; it does not currently receive r_member_postAnalytics. Therefore Nunuza cannot collect personal-profile post analytics for current connections. Do not infer analytics from w_member_social or r_member_social, request an unapproved scope, fabricate numbers, or ask customers to enter metrics. If LinkedIn grants the app r_member_postAnalytics and a member consents to it, Nunuza can enable the official read-only endpoint behind an explicit scope check. Until then, workflow signals remain the source for internal learning.

## Deliberate boundaries

- Google News RSS is an initial discovery feed, not a comprehensive market-intelligence provider or guarantee of source quality.
- The cycle currently ranks headlines and feed evidence; it does not crawl full articles, scrape LinkedIn, or claim to have verified facts beyond the retrieved evidence.
- No sync_metrics job should be enqueued until LinkedIn grants a supported analytics permission or another official metrics source is integrated.
- generate_plan remains the existing user-invoked content-planning workflow; it is not a second autonomous scheduler.
- reconcile_post remains a user-confirmed workflow through the existing reconciliation endpoint. Nunuza does not guess whether an ambiguous post went live.
- External engagement analytics and long-horizon causal performance learning remain unavailable until an approved official data source exists.


## Current implementation limits

- The current cycle is durable at the job and audit-event level, but research candidates, decisions, and learning summaries are stored as workspace-scoped audit events rather than separate normalized intelligence tables. There is no independent long-lived opportunity lifecycle or strategy-adaptation table yet.
- Research is one Google News RSS query per cycle. There is no article-body retrieval, multi-provider corroboration, source reputation service, or shared research cache. Repeated research is limited by the daily cycle key and 14-day title deduplication.
- Relevance and confidence labels are heuristic ranking bands, not calibrated probabilities or verified fact checks. A feed excerpt is evidence to draft from, not proof that every claim in the article is correct.
- Internal approvals, rejections, and edits influence future ranking. External performance evaluation and causal learning remain unavailable without an approved LinkedIn analytics permission.
- The CI workflow validates type checking, lint, unit tests, production build, PostgreSQL publishing reservations, and concurrent job claiming. It does not perform a live end-to-end test against a real LinkedIn account, Telegram bot, Groq/OpenRouter credentials, or a production Supabase project.
