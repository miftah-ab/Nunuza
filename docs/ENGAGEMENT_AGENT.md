# Engagement Agent

## Product behavior

The Engagement Agent has three action sources under one lifecycle:

1. **External post comments** — discover eligible conversations and prepare a contextual comment.
2. **Replies to other people's comments** — preserve the original post and comment URNs so a reply is attached to the correct thread.
3. **Replies to comments on the connected member's own posts** — detect questions, substantive feedback, disagreements, and other comments worth answering. Ignore spam and low-value noise; escalate sensitive or hostile cases instead of drafting a risky response.

All three use the workspace's existing audience, goals, content pillars, voice, and exclusions. Do not create duplicate strategy fields.

## Approval is mandatory

Every comment and reply is human-approved. The same action can be approved through the Nunuza inbox/push notification or Telegram, but the database is authoritative.

An approval is bound to the exact SHA-256 hash of the draft. Any edit changes the hash and invalidates the prior approval. Approval is owner-only, single-use, expires after 48 hours, and cannot be replayed after a state transition. A notification is only a delivery mechanism; possession of a notification is not authorization.

The durable `engagement_actions` table stores the lifecycle, source context, target identifiers, draft, hash, approval evidence, and publication/reconciliation result. It does not store access tokens. Reply records must include both the parent post URN and parent comment URN.

## Lifecycle

`discovered → drafted → awaiting_approval → approved → publishing → published`

Terminal/exception states: `rejected`, `expired`, `ignored`, `failed`, and `needs_reconciliation`.

Do not blindly retry a comment creation after a timeout or ambiguous provider response. Reconcile first to prevent duplicate public comments.

## LinkedIn access gates

The current connection requesting `w_member_social` does not establish the newer feed permissions required by the Comments API. LinkedIn's current documentation identifies:

- `r_member_social_feed` for reading member posts/comments; this is restricted to selected developers.
- `w_member_social_feed` for creating member comments/replies.

The discovery and publishing adapters must fail closed unless the connected token contains the exact required permission and the app is provisioned for the relevant API product. Do not scrape LinkedIn, automate its website, or infer access from API quotas. Until access is verified, the agent may be developed and tested with fixtures, but live discovery and comment publication remain disabled.

Sources:
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/comments-api?view=li-lms-2026-07
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview?view=li-lms-2026-08
- https://is.linkedin.com/legal/user-agreement

## Delivery plan

- Foundation: normalized action records and atomic owner-only approval/rejection.
- Next: official LinkedIn read adapter, gated by granted read permission; collect own-post comments and eligible external conversations only from permitted endpoints.
- Next: strategy-aware relevance triage and draft generation, then push + Telegram delivery.
- Next: approval callbacks, durable queue, exact target verification, publication adapter, and ambiguous-outcome reconciliation.
- Final: minimal settings (enable/disable and daily cap) and activity history. Approval is not configurable and cannot be disabled.
