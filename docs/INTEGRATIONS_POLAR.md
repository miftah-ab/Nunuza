# Polar Billing Integration Architecture

**Status:** IMPLEMENTED & TESTED (SANDBOX / INTEGRATION GATED)  
**Governing decisions:** BED-08, Spec §12, Notion Product Spec v1.0  
**Implementation files:**
- [`src/lib/integrations/polar/crypto.ts`](file:///c:/Users/user/.gemini/antigravity-ide/scratch/Nunuza/src/lib/integrations/polar/crypto.ts)
- [`src/lib/integrations/polar/client.ts`](file:///c:/Users/user/.gemini/antigravity-ide/scratch/Nunuza/src/lib/integrations/polar/client.ts)
- [`src/lib/integrations/polar/service.ts`](file:///c:/Users/user/.gemini/antigravity-ide/scratch/Nunuza/src/lib/integrations/polar/service.ts)
- [`src/app/api/webhooks/polar/route.ts`](file:///c:/Users/user/.gemini/antigravity-ide/scratch/Nunuza/src/app/api/webhooks/polar/route.ts)
- [`src/app/api/billing/checkout/route.ts`](file:///c:/Users/user/.gemini/antigravity-ide/scratch/Nunuza/src/app/api/billing/checkout/route.ts)
- [`src/app/app/billing/BillingClient.tsx`](file:///c:/Users/user/.gemini/antigravity-ide/scratch/Nunuza/src/app/app/billing/BillingClient.tsx)
- [`src/app/app/billing/page.tsx`](file:///c:/Users/user/.gemini/antigravity-ide/scratch/Nunuza/src/app/app/billing/page.tsx)
- [`src/lib/integrations/polar/service.test.ts`](file:///c:/Users/user/.gemini/antigravity-ide/scratch/Nunuza/src/lib/integrations/polar/service.test.ts)

---

## 1. Commercial Terms

Nunuza operates a single commercial subscription offer:
* **Plan:** Nunuza Solo
* **Price:** USD $29.00 / month (no hidden tiers or discounts)
* **Trial:** 14-day trial with payment card required at checkout
* **Merchant of Record:** Polar (handles VAT, tax, invoicing, and refunds)
* **Preview / Beta Exemption:** Public preview (`draft_only`) and limited cohort publishing (`publishing_beta`) require **no payment card or subscription**. They are completely decoupled from checkout.

---

## 2. Webhook Cryptographic Verification

Polar uses Standard Webhooks (Svix-compatible HMAC-SHA256 signatures).
* **Headers:**
  - `webhook-id`: Unique message identifier
  - `webhook-timestamp`: Seconds since epoch
  - `webhook-signature`: Format `v1,<base64>`
* **Signature Algorithm:**
  - Payload signed: `${webhookId}.${webhookTimestamp}.${rawBody}`
  - Secret format: standard utf-8 or `whsec_<base64>`
  - Tolerance: Events older than 300 seconds (5 minutes) or from the future are rejected.
  - Constant-time comparison: `crypto.timingSafeEqual` prevents timing attacks.

---

## 3. Idempotency & Event Ordering

1. **Idempotency Deduplication:**
   Every event ID is recorded in `public.billing_webhook_events`. If an event with the same ID has already been marked `processed`, subsequent deliveries return `duplicate` and take no action.
2. **Out-of-Order Stale Event Protection:**
   Before updating `subscriptions` or `workspaces`, the service checks the existing record's `updated_at`. If incoming event `updated_at` is older than existing state, it is safely marked as skipped to prevent state regression.

---

## 4. Entitlement State Mapping

Polar subscription status maps strictly to Nunuza's server-side `entitlement_type`:

| Polar Status | Conditions | Nunuza Entitlement | Access Permitted |
| :--- | :--- | :--- | :--- |
| `trialing` | Within 14-day trial | `paid_trial` | Full v1.0.0 features under trial |
| `active` | Active subscription | `paid_active` | Full v1.0.0 paid features |
| `past_due` | Payment retry / grace period | `paid_active` (grace) | Preserves read, export, and existing draft workflows |
| `canceled` | `cancel_at_period_end` is true & period active | `paid_active` | Retains paid access until period end date |
| `canceled` | Period ended | `inactive` | Read & export only; no new paid jobs |
| `revoked` / `unpaid` | Immediate termination | `inactive` | Read & export only |
| `incomplete` | Pre-checkout | `draft_only` | Drafts & planning only; no publishing |

---

## 5. Seller Eligibility & Launch Gate (BED-08)

Per Notion Product Spec v1.0 and BED-08:
* Polar requires the legally responsible seller to be at least 18 years old and fully onboarded for tax/payouts.
* In development/pre-release, `isSellerEligible()` evaluates `process.env.POLAR_SELLER_ELIGIBLE === "true"`.
* When false, checkout attempts return `403 Forbidden` (`SELLER_INELIGIBLE`) with transparent user guidance.
* **Critical:** Seller ineligibility blocks paid checkout only; it **never** blocks the public draft-only preview or publishing beta.
