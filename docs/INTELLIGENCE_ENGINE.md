# Nunuza Intelligence Engine

## Current operating cycle

The existing Cloudflare Cron Trigger enqueues at most one agent_cycle job per workspace per UTC day. It uses the existing agent_jobs queue and runner; it does not introduce another scheduler. Active queued, running, or retryable cycles block a new cycle for that workspace, including across a UTC date boundary.

Each cycle reads the workspace strategy, audience, goals, pillars, voice profile, recent post history, approval decisions, and edit history. It queries Google News RSS using strategy keywords, keeps only fresh HTTPS items with a publisher and a non-trivial evidence excerpt, scores relevance and freshness, discounts rejected-topic matches, boosts approved-topic matches, and avoids near-duplicate recent posts.

Research metadata and the evidence excerpt are stored in workspace-scoped audit events. The generated post retains the source, article link, publisher link, publication time, and excerpt in source_notes. Retrieved source text is untrusted: it is passed as evidence, never as instructions.

## Actions and safety

- Approval-required workspaces receive a needs_review post and a Telegram notification. Approval and rejection actions are recorded in the existing approval_events table.
- Autopilot requires explicit autopilot operating mode and active_autopilot state, a publish-capable entitlement, an unpaused workspace, a connected non-expired LinkedIn connection with w_member_social, and the existing publishing worker's final entitlement and cap checks.
- The worker checks autopilot state again immediately before publishing an agent-created autopilot job.
- A missing or ambiguous LinkedIn publication ID is never fabricated or blindly retried. Existing manual reconciliation remains authoritative.

## Learning

The first learning pass uses the previous 90 days of approval/rejection decisions and user-edit version snapshots. Approved and rejected title/pillar terms influence later opportunity ranking. User edits are tracked separately from approval outcomes; the engine does not infer audience performance from them.

## LinkedIn analytics limitation

The current LinkedIn OAuth scopes include w_member_social and OpenID Connect identity scopes. The repository's LinkedIn access evidence records r_member_social as restricted to approved users. Therefore personal-profile post analytics such as impressions, likes, comments, and engagement are not currently available through the existing self-service scope set. Nunuza must show these metrics as unavailable rather than inventing values or asking customers to enter them. Workflow signals remain available for internal learning.

## Deliberate boundaries

- Google News RSS is an initial discovery feed, not a comprehensive market-intelligence provider or guarantee of source quality.
- The cycle currently ranks headlines and feed evidence; it does not crawl full articles, scrape LinkedIn, or claim to have verified facts beyond the retrieved evidence.
- No sync_metrics job should be enqueued until LinkedIn grants a supported analytics permission or another official metrics source is integrated.
- generate_plan remains the existing user-invoked content-planning workflow; it is not a second autonomous scheduler.
- reconcile_post remains a user-confirmed workflow through the existing reconciliation endpoint. Nunuza does not guess whether an ambiguous post went live.
- External engagement analytics and long-horizon causal performance learning remain unavailable until an approved official data source exists.
