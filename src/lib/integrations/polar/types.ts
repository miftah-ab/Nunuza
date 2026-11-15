/**
 * Polar Billing & Subscription Types.
 *
 * Implements BED-08, Spec §12 (Polar billing & trial), and canonical data contracts.
 * Strictly mirrors Polar API and Webhook event structures.
 */

import type { EntitlementType } from "@/types/database";

export type PolarSubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "revoked";

export interface PolarSubscriptionCustomer {
  id: string;
  email: string;
  name?: string | null;
}

export interface PolarSubscriptionData {
  id: string;
  status: PolarSubscriptionStatus;
  product_id: string;
  /** Older API/webhook integrations may expose a singular price_id. Current Polar
   * Subscription objects expose prices[]; entitlement checks support both forms. */
  price_id?: string | null;
  prices?: Array<{ id: string; product_id?: string | null }>;
  customer_id: string;
  customer: PolarSubscriptionCustomer;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_start: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  ended_at: string | null;
  created_at: string;
  modified_at?: string | null;
  updated_at?: string | null;
  metadata?: Record<string, string>;
}

export type PolarWebhookEventType =
  | "subscription.created"
  | "subscription.updated"
  | "subscription.active"
  | "subscription.past_due"
  | "subscription.canceled"
  | "subscription.uncanceled"
  | "subscription.revoked"
  | "checkout.created"
  | "checkout.updated";

export interface PolarWebhookEvent {
  id: string;
  type: PolarWebhookEventType;
  created_at: string;
  data: PolarSubscriptionData | Record<string, unknown>;
}

export interface CheckoutSessionOptions {
  workspaceId: string;
  userEmail: string;
  customerId?: string | null;
  successUrl: string;
}

export interface CheckoutSessionResult {
  checkoutUrl: string;
  sessionId?: string;
}

export interface PolarConfig {
  accessToken: string;
  webhookSecret: string;
  productId: string;
  priceId?: string;
  server: "sandbox" | "production";
}

export interface BillingDetails {
  planName: "Nunuza Solo";
  amount: 29;
  currency: "USD";
  interval: "month";
  trialDays: 14;
  isTrialRequired: boolean;
  accessMode?: "private_beta" | "commercial";
  entitlement: EntitlementType;
  subscription: {
    id: string;
    status: string;
    trialEnd: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  isConfigured: boolean;
  isSellerEligible: boolean;
}
