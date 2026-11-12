# Engagement Agent

## Implemented product behavior

The dashboard has a unified Engagement inbox. It can monitor comments on posts authored by the connected LinkedIn member, including posts published outside Nunuza, when the member-post read permission is granted. It uses the official Posts author finder and Comments API.

For comments on the member's own posts, the agent:
- ignores short, spam-like, and low-value comments;
- drafts a concise reply for questions and substantive discussion;
- applies the saved workspace strategy, voice, and phrase exclusions;
- creates a durable approval item and a high-priority inbox notification;
- sends a Telegram message with Approve and Reject buttons when Telegram is linked.

Every reply requires owner approval. Approval through the dashboard or Telegram creates one durable publish job. Publishing is guarded by the exact draft hash and the actual `w_member_social_feed` scope. An ambiguous LinkedIn response goes to `needs_reconciliation`; it is never blindly retried.

## Explicitly not available yet

The LinkedIn Posts API documents an author finder, not a general keyword-based member-feed search. The current app therefore cannot automatically discover arbitrary external posts from the user's network or search all LinkedIn discussions by topic. We must not pretend this works, scrape LinkedIn, automate the website, or use browser cookies.

The agent can only act on externally sourced posts if a supported official discovery capability is granted and implemented, or if the product later adds an explicit user-supplied target workflow. The user requested automatic discovery, so a manual URL field is not treated as a completed substitute.

## Approval and security

- The database is authoritative; push and Telegram are delivery channels only.
- Approval is owner-only, single-use, expires after 48 hours, and is bound to the exact SHA-256 draft hash.
- Any edited draft must be re-approved.
- Telegram callbacks are validated against the linked Telegram user, chat, workspace, and the action's pending state.
- Approval atomically enqueues one durable publish job.
- Publishing checks the actual `w_member_social_feed` grant and verifies the target thread.
- A timeout, 5xx, or missing provider comment ID moves the action to `needs_reconciliation`; never retry blindly.
- No access token is stored in an engagement action or job payload.

## LinkedIn access gates

The current OAuth connection requests `w_member_social`, which does not prove access to the newer member-feed comment APIs. The official Comments API lists:

- `r_member_social_feed` for reading member posts/comments; LinkedIn says this is restricted to selected developers.
- `w_member_social_feed` for creating member comments/replies.

The Posts API author finder is for retrieving posts by a known author; it is not a general public-feed keyword search endpoint.

LinkedIn's current Community Management API onboarding documentation states that Development-tier access is reviewed and requires a verified business email, registered organization, organization website/domain, and a verified LinkedIn Page. If an existing developer app already has other products, the Community Management Development-tier request may require a separate new app with no other API products, verified against the same company page. Standard-tier access requires a working integration and a review recording.

Until the relevant product is provisioned and the user reconnects with the actual feed scopes, the inbox shows the access gate and live scans/publishing remain disabled.

Sources:
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/comments-api?view=li-lms-2026-10
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-08
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-api-migration-guide?view=li-lms-2026-07

## Remaining work

1. Obtain LinkedIn's required product access and reconnect the member account with the granted feed scopes.
2. Verify own-post discovery and comment retrieval with a real authorized LinkedIn test account.
3. Add an approved, supported discovery source for external posts if LinkedIn grants an API for it. Do not use scraping.
4. Add nested-comment monitoring if the product's use case requires replying to replies as well as first-level comments.
5. Run end-to-end tests against LinkedIn sandbox/test data and Telegram, then promote the feature after CI and production smoke tests pass.

Approval is mandatory and cannot be disabled.
