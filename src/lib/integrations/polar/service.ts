/**
 * Polar Billing & Subscription Service.
 *
 * Implements:
 * - Idempotent webhook event processing with replay defense
 * - Event ordering protection
 * - State machine mapping Polar subscriptions to Nunuza entitlement types
 * - Verification that entitlement_type is the sole permission authority
 * - Defense against client-supplied parameter tampering
 */

import { createServiceClient } from "@/lib/supabase/server";
import type { EntitlementType, Subscription } from "@/types/database";
import type {
  BillingDetails,
  PolarSubscriptionData,
  PolarWebhookEvent,
} from "./types";
import { PolarClient } from "./client";

export class PolarService {
  private readonly polarClient: PolarClient;

  constructor(polarClient?: PolarClient) {
    this.polarClient = polarClient ?? new PolarClient();
  }

  /**
   * Maps Polar subscription status & dates to Nunuza entitlement_type.
   */
  mapPolarStatusToEntitlement(
    status: string,
    currentPeriodEnd: string | null,
    cancelAtPeriodEnd: boolean
  ): EntitlementType {
    const now = new Date();

    switch (status) {
      case "trialing":
        return "paid_trial";

      case "active":
        return "paid_active";

      case "past_due":
        // Grace period: retains paid entitlement during payment recovery
        return "paid_active";

      case "canceled": {
        // If cancellation is scheduled for period end, retain access until then
        if (cancelAtPeriodEnd && currentPeriodEnd && new Date(currentPeriodEnd) > now) {
          return "paid_active";
        }
        return "inactive";
      }

      case "incomplete_expired":
      case "unpaid":
      case "revoked":
        return "inactive";

      case "incomplete":
      default:
        return "draft_only";
    }
  }

  /**
   * Process incoming Polar webhook event idempotently.
   */
  async processWebhookEvent(
    event: PolarWebhookEvent,
    supabaseOverride?: any
  ): Promise<{ status: "processed" | "duplicate" | "skipped" | "failed"; reason?: string }> {
    const supabase = supabaseOverride || createServiceClient();
    const eventId = event.id;

    if (!eventId) {
      return { status: "failed", reason: "Missing event ID." };
    }

    // 1. Idempotency Check in billing_webhook_events
    const { data: existingEvent } = await supabase
      .from("billing_webhook_events")
      .select("provider_event_id, processing_status")
      .eq("provider_event_id", eventId)
      .maybeSingle();

    if (existingEvent && existingEvent.processing_status === "processed") {
      return { status: "duplicate", reason: "Event has already been processed." };
    }

    // Record pending event
    await supabase.from("billing_webhook_events").upsert(
      {
        provider_event_id: eventId,
        type: event.type,
        received_at: new Date().toISOString(),
        processing_status: "pending",
      },
      { onConflict: "provider_event_id" }
    );

    // 2. Filter for subscription-relevant events
    if (
      !event.type.startsWith("subscription.") &&
      !event.type.startsWith("checkout.")
    ) {
      await supabase
        .from("billing_webhook_events")
        .update({ processing_status: "processed", processed_at: new Date().toISOString() })
        .eq("provider_event_id", eventId);
      return { status: "skipped", reason: "Non-subscription event ignored." };
    }

    const subData = event.data as PolarSubscriptionData;
    if (!subData || !subData.id) {
      await supabase
        .from("billing_webhook_events")
        .update({
          processing_status: "failed",
          safe_error_code: "INVALID_DATA",
          processed_at: new Date().toISOString(),
        })
        .eq("provider_event_id", eventId);
      return { status: "failed", reason: "Missing subscription data." };
    }

    // 3. Resolve Workspace ID
    let workspaceId = subData.metadata?.workspace_id;

    // Fallback 1: lookup by existing subscription ID
    if (!workspaceId) {
      const { data: existingSub } = await supabase
        .from("subscriptions")
        .select("workspace_id")
        .eq("polar_subscription_id", subData.id)
        .maybeSingle();

      if (existingSub?.workspace_id) {
        workspaceId = existingSub.workspace_id;
      }
    }

    // Fallback 2: lookup by customer ID
    if (!workspaceId && subData.customer_id) {
      const { data: cust } = await supabase
        .from("billing_customers")
        .select("workspace_id")
        .eq("polar_customer_id", subData.customer_id)
        .maybeSingle();

      if (cust?.workspace_id) {
        workspaceId = cust.workspace_id;
      }
    }

    if (!workspaceId) {
      await supabase
        .from("billing_webhook_events")
        .update({
          processing_status: "failed",
          safe_error_code: "WORKSPACE_NOT_FOUND",
          processed_at: new Date().toISOString(),
        })
        .eq("provider_event_id", eventId);
      return { status: "failed", reason: "Target workspace could not be identified." };
    }

    // 4. Out-of-order Protection
    const { data: currentSub } = await supabase
      .from("subscriptions")
      .select("id, updated_at, status")
      .eq("polar_subscription_id", subData.id)
      .maybeSingle();

    if (currentSub?.updated_at && subData.updated_at) {
      const existingDate = new Date(currentSub.updated_at).getTime();
      const eventDate = new Date(subData.updated_at).getTime();

      if (eventDate < existingDate) {
        // Event is stale/out of order
        await supabase
          .from("billing_webhook_events")
          .update({
            processing_status: "processed",
            safe_error_code: "OUT_OF_ORDER_SKIPPED",
            processed_at: new Date().toISOString(),
          })
          .eq("provider_event_id", eventId);
        return { status: "skipped", reason: "Out of order event skipped." };
      }
    }

    // 5. Calculate new entitlement
    const newEntitlement = this.mapPolarStatusToEntitlement(
      subData.status,
      subData.current_period_end,
      subData.cancel_at_period_end
    );

    // 6. Record Customer Link
    if (subData.customer_id) {
      await supabase.from("billing_customers").upsert(
        {
          workspace_id: workspaceId,
          polar_customer_id: subData.customer_id,
        },
        { onConflict: "workspace_id" }
      );
    }

    // 7. Update Subscriptions table
    const subscriptionRecord: Partial<Subscription> = {
      workspace_id: workspaceId,
      polar_subscription_id: subData.id,
      product_id: subData.product_id,
      price_id: subData.price_id,
      status: subData.status,
      trial_start: subData.trial_start,
      trial_end: subData.trial_end,
      current_period_start: subData.current_period_start,
      current_period_end: subData.current_period_end,
      cancel_at_period_end: Boolean(subData.cancel_at_period_end),
      entitlement_snapshot: newEntitlement,
      updated_at: subData.updated_at || new Date().toISOString(),
    };

    const { error: subErr } = await supabase
      .from("subscriptions")
      .upsert(subscriptionRecord, { onConflict: "polar_subscription_id" });

    if (subErr) {
      await supabase
        .from("billing_webhook_events")
        .update({
          processing_status: "failed",
          safe_error_code: "SUBSCRIPTION_UPSERT_FAILED",
          processed_at: new Date().toISOString(),
        })
        .eq("provider_event_id", eventId);
      return { status: "failed", reason: subErr.message };
    }

    // 8. Reconcile Workspace Entitlement
    const { error: wsErr } = await supabase
      .from("workspaces")
      .update({
        entitlement_type: newEntitlement,
        updated_at: new Date().toISOString(),
      })
      .eq("id", workspaceId);

    if (wsErr) {
      await supabase
        .from("billing_webhook_events")
        .update({
          processing_status: "failed",
          safe_error_code: "WORKSPACE_ENTITLEMENT_UPDATE_FAILED",
          processed_at: new Date().toISOString(),
        })
        .eq("provider_event_id", eventId);
      return { status: "failed", reason: wsErr.message };
    }

    // 9. Audit Event
    await supabase.from("audit_events").insert({
      workspace_id: workspaceId,
      actor_type: "system",
      action: "subscription_lifecycle",
      resource_type: "subscription",
      resource_id: subData.id,
      safe_metadata: {
        event_type: event.type,
        status: subData.status,
        new_entitlement: newEntitlement,
      },
    });

    // 10. Mark Webhook Processed
    await supabase
      .from("billing_webhook_events")
      .update({
        processing_status: "processed",
        processed_at: new Date().toISOString(),
      })
      .eq("provider_event_id", eventId);

    return { status: "processed" };
  }

  /**
   * Retrieves verified billing details for a workspace.
   */
  async getBillingDetails(
    workspaceId: string,
    supabaseOverride?: any
  ): Promise<BillingDetails> {
    const supabase = supabaseOverride || createServiceClient();

    const { data: workspace } = await supabase
      .from("workspaces")
      .select("entitlement_type")
      .eq("id", workspaceId)
      .single();

    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("polar_subscription_id, status, trial_end, current_period_end, cancel_at_period_end")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    return {
      planName: "Nunuza Solo",
      amount: 29,
      currency: "USD",
      interval: "month",
      trialDays: 14,
      isTrialRequired: true,
      entitlement: workspace?.entitlement_type ?? "draft_only",
      subscription: subscription
        ? {
            id: subscription.polar_subscription_id,
            status: subscription.status,
            trialEnd: subscription.trial_end,
            currentPeriodEnd: subscription.current_period_end,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
          }
        : null,
      isConfigured: this.polarClient.isConfigured(),
      isSellerEligible: this.polarClient.isSellerEligible(),
    };
  }
}
