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
  | "unpaid";

export interface PolarSubscriptionCustomer {
  id: string;
  email: string;
  name?: string | null;
}

export interface PolarSubscriptionData {
  id: string;
  status: PolarSubscriptionStatus;
  product_id: string;
  price_id: string;
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
  updated_at: string;
  metadata?: Record<string, string>;
}

export type PolarWebhookEventType =
  | "subscription.created"
  | "subscription.updated"
  | "subscription.active"
  | "subscription.canceled"
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
  priceId: string;
  server: "sandbox" | "production";
}

export interface BillingDetails {
  planName: "Nunuza Solo";
  amount: 29;
  currency: "USD";
  interval: "month";
  trialDays: 14;
  isTrialRequired: boolean;
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
