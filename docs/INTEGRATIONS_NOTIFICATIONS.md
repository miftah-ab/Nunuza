# Notifications

Nunuza notifications use one durable inbox and three delivery paths:

- **In-app inbox:** persistent source of truth for every important event.
- **Web Push:** browser/device alerts for high-priority and critical events.
- **Telegram:** high-priority and critical alerts when a workspace has an active Telegram link.

Routine notifications stay in the inbox. Critical operational alerts are not controlled by user notification preferences.

## Events

Database triggers create idempotent inbox records for:
- Post published, failed, uncertain, and newly awaiting review.
- Agent jobs waiting for approval, terminally failed, or requiring reconciliation.
- Workspace agent paused, blocked, or requiring attention.
- LinkedIn/other integration connection expired or errored.
- Subscription payment status becoming past due or unpaid.

The worker also creates a reminder when a scheduled post is within 30 minutes of publication.

The notification event row is the durable inbox item and delivery outbox. Each channel has its own status and retry counter. Delivery is at-least-once in ambiguous failure cases; idempotency prevents duplicate inbox records, but external push/Telegram providers cannot guarantee exactly-once delivery.

## Browser permission experience

The dashboard shows the requested banner:

> Stay informed with Nunuza  
> Get important updates about your posts, approvals, and agent activity, even when you're away.  
> Enable notifications

It has one action button and an X dismiss control. Dismissal lasts for the current browser tab session; it appears again on a later visit until a subscription is registered. Permission is requested only from the button click. If the browser previously denied permission, it may require the user to change browser settings; Nunuza cannot override that browser restriction.

The service worker is served from /sw.js. iOS/iPadOS web push requires a supported OS version and the web app added to the Home Screen.

## Required environment secrets

Set these on the server environment that handles authenticated Next.js routes and on the Cloudflare Worker that runs the scheduled delivery pass:

- WEB_PUSH_VAPID_PUBLIC_KEY: base64url-encoded uncompressed P-256 public key (65 bytes).
- WEB_PUSH_VAPID_PRIVATE_KEY: base64url-encoded raw P-256 private scalar (32 bytes).
- WEB_PUSH_VAPID_SUBJECT: contact URI, e.g. mailto:support@nunuza.com.
- WEB_PUSH_SUBSCRIPTION_ENCRYPTION_KEY: 32 random bytes encoded as 64 hexadecimal characters. This encrypts browser endpoints and keys before they are stored.

Generate a VAPID pair with Node.js using the Web Crypto API:
- Generate an ECDSA P-256 key pair with sign/verify usages.
- Export the public key in raw format and base64url encode it.
- Export the private key as JWK and use its d value.
- Generate a separate random 32-byte hex key for WEB_PUSH_SUBSCRIPTION_ENCRYPTION_KEY.

Use the same VAPID pair in all environments for which you want subscriptions to remain valid. Keep the private key and subscription encryption key server-side only. Never add either to a NEXT_PUBLIC_ variable.

## Database and deployment

1. Apply supabase/migrations/0020_durable_notifications.sql after the prior migration sequence is present.
2. Set the environment secrets above in the deployed Next.js environment and Cloudflare Worker.
3. Deploy the updated Worker so its existing five-minute cron trigger dispatches pending notifications.
4. Confirm the public site serves /sw.js over HTTPS.
5. Test permission grant, subscription persistence, push while the app is closed, inbox read/unread state, Telegram delivery, retry behavior, and expired-subscription cleanup.

The database migration is not applied automatically by this code change. Do not enable production delivery until the migration and secrets are configured.
