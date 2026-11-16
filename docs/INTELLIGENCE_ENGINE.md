# Nunuza Intelligence Engine

## Current operating cycle

The existing Cloudflare Cron Trigger enqueues at most one agent_cycle job per workspace per UTC day. It uses the existing agent_jobs queue and runner; it does not introduce another scheduler. Active queued, running, or retryable cycles block a new cycle for that workspace, including across a UTC date boundary.

Each cycle reads the workspace strategy, audience, goals, pillars, voice profile, recent post history, approval decisions, and edit history. It queries Google News RSS using strategy keywords, keeps only fresh HTTPS items with a publisher and a non-trivial evidence excerpt, scores relevance against both headlines and evidence, requires a minimum evidence-depth band before drafting, applies strategy and voice exclusions, discounts rejected-topic matches, boosts approved-topic matches, and avoids near-duplicate recent posts. Thin evidence is marked as requiring more research; weak or repetitive opportunities are monitored instead of being forced into drafts.

Research metadata and the evidence excerpt are stored in workspace-scoped audit events. The existing dashboard activity feed shows the discovery, short evidence excerpt, relevance band, decision reason, and source link. Telegram draft/autopilot notices include the concise reason and source. The generated post retains the source, article link, publisher link, publication time, and excerpt in source_notes. Retrieved source text is untrusted: it is passed as evidence, never as instructions.

## Autonomy behaviour

- **Autopilot veto window.** Autopilot never publishes instantly. The post is scheduled for the workspace's next preferred time (strategy `preferred_time`, `preferred_days`, `timezone`) but never sooner than 15 minutes out, through the same `schedule_post_atomic` function the dashboard uses. The user gets the draft image in Telegram with a **Stop** button. Stop cancels the publish job and returns the post to review. If caps or pause block scheduling, the post becomes a normal review draft.
- **Telegram approval schedules.** Approving a draft in Telegram schedules it at the next preferred slot (at least 5 minutes out) with a **Cancel schedule** button.
- **Review reminders.** Agent drafts still waiting after 24 hours get one reminder (the draft image with buttons), recorded as `review_reminder_sent`.
- **Research retry.** When fewer than 3 stories come back, a wider phrase-based query runs once. If nothing qualifies, an evergreen pillar post is drafted. Evergreen posts always go to review, even in Autopilot.
- **Claim self-check.** Figures and links in a draft must appear in the source. One corrected retry; if it still fails, Autopilot hands the post to the user for review.
- **Tells you why it stopped.** When a cycle is skipped for a reason you can fix (LinkedIn disconnected, draft limit reached, strategy empty, everything excluded) you get one notice per reason per week in the inbox, push and Telegram.
- **LinkedIn expiry warnings.** At 7, 3 and 1 days before the 60-day token ends, and once after it has ended.
- **No duplicate Telegram text.** The generic "ready for approval" and "scheduled" notifications are inbox/push only, because Telegram already gets the draft image with buttons.
- **Not done:** attaching generated images to agent posts. Publishing supports only carousels (2+ images) and PDFs, so a single generated image needs a schema change first.

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


## Dependency security note

- The unused optional `rclone.js` peer was removed from development dependencies; the application does not configure OpenNext R2 remote cache, so this removed its otherwise-unused `adm-zip` dependency path.
- The nested `glob` used by `@node-minify/core` is pinned to patched `10.5.0` to address the high-severity CLI command-injection advisory. The OpenNext adapter still brings a separate `glob@13` dependency with a moderate AbortSignal-cancellation advisory; its upstream-compatible fix is `14.0.2`, which is outside the adapter's current `^13` range. Do not force a major override without validating the adapter. The production audit gate therefore fails on high-severity findings while the moderate upstream-pinned advisory remains tracked.
