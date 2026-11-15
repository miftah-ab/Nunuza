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
    cancelAtPeriodEnd: boolean,
    trialEnd: string | null = null
  ): EntitlementType {
    const isFuture = (value: string | null) => {
      if (!value) return false;
      const timestamp = Date.parse(value);
      return Number.isFinite(timestamp) && timestamp > Date.now();
    };

    switch (status) {
      case "trialing":
        return isFuture(trialEnd) ? "paid_trial" : "inactive";
      case "active":
        return isFuture(currentPeriodEnd) ? "paid_active" : "inactive";
      // Polar's past_due state is recoverable, but benefits may already be
      // revoked depending on the seller's configured grace-period policy.
      // Keep drafts readable/editable, but do not grant paid operations until
      // Polar confirms the subscription is active again.
      case "past_due":
        return "draft_only";
      case "canceled":
        return cancelAtPeriodEnd && isFuture(currentPeriodEnd)
          ? "paid_active"
          : "inactive";
      // Checkout is not complete yet; retain only the limited draft experience.
      case "incomplete":
        return "draft_only";
      case "incomplete_expired":
      case "unpaid":
      case "revoked":
      default:
        return "inactive";
    }
  }

  /**
   * Process incoming Polar webhook event idempotently.
   */
  private async markWebhookEvent(
    supabase: any,
    eventId: string,
    status: "processed" | "failed" | "duplicate",
    safeErrorCode?: string
  ): Promise<void> {
    const terminal = status === "processed" || status === "duplicate";
    const { error } = await supabase
      .from("billing_webhook_events")
      .update({
        processing_status: status,
        processed_at: terminal ? new Date().toISOString() : null,
        processing_started_at: null,
        safe_error_code: safeErrorCode ?? null,
      })
      .eq("provider_event_id", eventId);
    if (error) throw new Error(`Could not update billing webhook event: ${error.message}`);
  }

  async processWebhookEvent(
    event: PolarWebhookEvent,
    supabaseOverride?: any
  ): Promise<{ status: "processed" | "duplicate" | "skipped" | "failed"; reason?: string }> {
    const supabase = supabaseOverride || createServiceClient();
    const eventId = event.id;
    if (!eventId) return { status: "failed", reason: "Missing event ID." };

    const { data: claimRows, error: claimError } = await supabase.rpc(
      "claim_billing_webhook_event",
      { p_provider_event_id: eventId, p_event_type: event.type }
    );
    if (claimError) {
      return { status: "failed", reason: "Billing event could not be claimed safely." };
    }

    const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
    if (!claim?.claimed) {
      if (claim?.reason === "ALREADY_PROCESSED") {
        return { status: "duplicate", reason: "Event has already been processed." };
      }
      if (claim?.reason === "IN_PROGRESS") {
        // A retryable response asks Polar to redeliver after the active lease.
        return { status: "failed", reason: "Event is already being processed; retry later." };
      }
      return { status: "failed", reason: "Billing event claim was not confirmed." };
    }

    try {
      // Checkout events are not subscription snapshots and cannot change
      // workspace entitlements.
      if (!event.type.startsWith("subscription.")) {
        await this.markWebhookEvent(supabase, eventId, "processed", "NON_SUBSCRIPTION_EVENT");
        return { status: "skipped", reason: "Non-subscription event ignored." };
      }

      const subData = event.data as PolarSubscriptionData | null;
      const configuredPriceId = this.polarClient.getMatchingPriceId(
        subData?.product_id,
        subData?.prices,
        subData?.price_id
      );
      if (!subData?.id || !subData.customer_id || !subData.product_id || !configuredPriceId) {
        await this.markWebhookEvent(supabase, eventId, "processed", "UNRELATED_OR_INVALID_OFFER");
        return { status: "skipped", reason: "Subscription does not match the configured Nunuza offer." };
      }

      if (!this.polarClient.matchesConfiguredOffer(subData.product_id, configuredPriceId)) {
        await this.markWebhookEvent(supabase, eventId, "processed", "UNRELATED_PRODUCT_OR_PRICE");
        return { status: "skipped", reason: "Subscription does not match the configured Nunuza offer." };
      }

      let workspaceId: string | null = subData.metadata?.workspace_id ?? null;
      if (!workspaceId) {
        const { data: existingSub, error: existingSubError } = await supabase
          .from("subscriptions")
          .select("workspace_id")
          .eq("polar_subscription_id", subData.id)
          .maybeSingle();
        if (existingSubError) throw new Error("Could not resolve the subscription workspace.");
        workspaceId = existingSub?.workspace_id ?? null;
      }

      if (!workspaceId) {
        const { data: customer, error: customerLookupError } = await supabase
          .from("billing_customers")
          .select("workspace_id")
          .eq("polar_customer_id", subData.customer_id)
          .maybeSingle();
        if (customerLookupError) throw new Error("Could not resolve the billing customer workspace.");
        workspaceId = customer?.workspace_id ?? null;
      }

      if (!workspaceId) {
        await this.markWebhookEvent(supabase, eventId, "processed", "WORKSPACE_NOT_FOUND");
        return { status: "skipped", reason: "No Nunuza workspace is linked to this subscription." };
      }

      const { data: workspace, error: workspaceError } = await supabase
        .from("workspaces")
        .select("id, entitlement_type, access_mode")
        .eq("id", workspaceId)
        .maybeSingle();
      if (workspaceError) throw new Error("Could not verify the target workspace.");
      if (!workspace) {
        await this.markWebhookEvent(supabase, eventId, "processed", "WORKSPACE_NOT_FOUND");
        return { status: "skipped", reason: "Target workspace no longer exists." };
      }

      if (workspace.access_mode === "private_beta" || workspace.entitlement_type === "internal_beta") {
        await this.markWebhookEvent(supabase, eventId, "processed", "PRIVATE_BETA_ENTITLEMENT_PRESERVED");
        return { status: "skipped", reason: "Private beta entitlement is managed separately." };
      }

      const { data: customerById, error: customerByIdError } = await supabase
        .from("billing_customers")
        .select("workspace_id")
        .eq("polar_customer_id", subData.customer_id)
        .maybeSingle();
      if (customerByIdError) throw new Error("Could not verify the Polar customer mapping.");
      if (customerById && customerById.workspace_id !== workspaceId) {
        await this.markWebhookEvent(supabase, eventId, "failed", "CUSTOMER_WORKSPACE_MISMATCH");
        return { status: "failed", reason: "Polar customer is already linked to another workspace." };
      }

      const { data: customerByWorkspace, error: customerByWorkspaceError } = await supabase
        .from("billing_customers")
        .select("polar_customer_id")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (customerByWorkspaceError) throw new Error("Could not verify the workspace billing mapping.");
      if (customerByWorkspace && customerByWorkspace.polar_customer_id !== subData.customer_id) {
        await this.markWebhookEvent(supabase, eventId, "failed", "WORKSPACE_CUSTOMER_MISMATCH");
        return { status: "failed", reason: "Workspace is already linked to a different Polar customer." };
      }

      const { data: currentSub, error: currentSubError } = await supabase
        .from("subscriptions")
        .select("id, workspace_id, provider_modified_at")
        .eq("polar_subscription_id", subData.id)
        .maybeSingle();
      if (currentSubError) throw new Error("Could not verify the existing subscription mapping.");
      if (currentSub && currentSub.workspace_id !== workspaceId) {
        await this.markWebhookEvent(supabase, eventId, "failed", "SUBSCRIPTION_WORKSPACE_MISMATCH");
        return { status: "failed", reason: "Subscription is already linked to another workspace." };
      }

      const providerModifiedAt =
        subData.modified_at || subData.updated_at || event.created_at || new Date().toISOString();
      const incomingModifiedMs = Date.parse(providerModifiedAt);
      const currentModifiedMs = currentSub?.provider_modified_at
        ? Date.parse(currentSub.provider_modified_at)
        : Number.NaN;
      if (
        Number.isFinite(incomingModifiedMs) &&
        Number.isFinite(currentModifiedMs) &&
        incomingModifiedMs <= currentModifiedMs
      ) {
        await this.markWebhookEvent(supabase, eventId, "duplicate", "OUT_OF_ORDER_SKIPPED");
        return { status: "skipped", reason: "Older or duplicate provider subscription version skipped." };
      }

      if (!customerByWorkspace) {
        const { error: customerInsertError } = await supabase
          .from("billing_customers")
          .insert({
            workspace_id: workspaceId,
            polar_customer_id: subData.customer_id,
          });
        if (customerInsertError) throw new Error("Could not persist the Polar customer mapping.");
      }

      const newEntitlement = this.mapPolarStatusToEntitlement(
        subData.status,
        subData.current_period_end,
        subData.cancel_at_period_end,
        subData.trial_end
      );
      const now = new Date().toISOString();
      const subscriptionRecord: Partial<Subscription> = {
        workspace_id: workspaceId,
        polar_subscription_id: subData.id,
        product_id: subData.product_id,
        price_id: configuredPriceId,
        status: subData.status,
        trial_start: subData.trial_start,
        trial_end: subData.trial_end,
        current_period_start: subData.current_period_start,
        current_period_end: subData.current_period_end,
        cancel_at_period_end: subData.cancel_at_period_end,
        entitlement_snapshot: newEntitlement,
        updated_at: providerModifiedAt,
        provider_verified_at: now,
        provider_modified_at: providerModifiedAt,
      };

      const { error: subscriptionError } = await supabase
        .from("subscriptions")
        .upsert(subscriptionRecord, { onConflict: "polar_subscription_id" });
      if (subscriptionError) throw new Error("Could not persist the Polar subscription.");

      const { error: workspaceUpdateError } = await supabase
        .from("workspaces")
        .update({ entitlement_type: newEntitlement })
        .eq("id", workspaceId);
      if (workspaceUpdateError) throw new Error("Could not update workspace entitlement.");

      await this.markWebhookEvent(supabase, eventId, "processed");
      return { status: "processed" };
    } catch (error) {
      console.error("[polar] Webhook processing failed:", error);
      try {
        await this.markWebhookEvent(supabase, eventId, "failed", "PROCESSING_FAILED");
      } catch (markError) {
        console.error("[polar] Could not mark webhook event failed:", markError);
      }
      return { status: "failed", reason: "Subscription event could not be processed safely." };
    }
  }

  /**
   * Re-fetch the provider's current subscription before any paid operation.
   * A past_due subscription remains in the restricted draft tier because
   * Polar may revoke benefits during payment recovery depending on seller policy.
   */
  async getVerifiedWorkspaceEntitlement(
    workspaceId: string,
    supabaseOverride?: any
  ): Promise<EntitlementType> {
    const supabase = supabaseOverride || createServiceClient();
    const { data: workspace, error: workspaceError } = await supabase
      .from("workspaces")
      .select("id, entitlement_type, access_mode")
      .eq("id", workspaceId)
      .maybeSingle();

    if (workspaceError || !workspace) {
      throw new Error("Workspace entitlement could not be verified.");
    }

    if (workspace.access_mode === "private_beta" || workspace.entitlement_type === "internal_beta") {
      return "internal_beta";
    }

    const { data: subscription, error: subscriptionError } = await supabase
      .from("subscriptions")
      .select("id, polar_subscription_id, product_id, price_id, status, trial_start, trial_end, current_period_start, current_period_end, cancel_at_period_end")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subscriptionError) {
      throw new Error("Workspace subscription could not be verified.");
    }

    if (!subscription) {
      const hasPaidEntitlement = ["paid_trial", "paid_active"].includes(workspace.entitlement_type);
      if (hasPaidEntitlement) {
        const { error } = await supabase
          .from("workspaces")
          .update({ entitlement_type: "inactive" })
          .eq("id", workspaceId);
        if (error) throw new Error("Expired workspace entitlement could not be revoked.");
        return "inactive";
      }
      return (workspace.entitlement_type || "inactive") as EntitlementType;
    }

    if (!this.polarClient.isConfigured()) {
      throw new Error("Polar billing is not fully configured; paid access is paused.");
    }

    const liveSubscription = await this.polarClient.getSubscription(
      subscription.polar_subscription_id
    ) as PolarSubscriptionData;

    if (
      liveSubscription?.id !== subscription.polar_subscription_id ||
      !this.polarClient.matchesConfiguredOffer(
        liveSubscription?.product_id,
        liveSubscription?.prices ?? liveSubscription?.price_id
      )
    ) {
      throw new Error("The provider subscription does not match the configured Nunuza offer.");
    }

    const entitlement = this.mapPolarStatusToEntitlement(
      liveSubscription.status,
      liveSubscription.current_period_end,
      liveSubscription.cancel_at_period_end,
      liveSubscription.trial_end
    );
    const now = new Date().toISOString();
    const providerModifiedAt =
      liveSubscription.modified_at || liveSubscription.updated_at || now;

    const { error: subscriptionUpdateError } = await supabase
      .from("subscriptions")
      .update({
        status: liveSubscription.status,
        trial_start: liveSubscription.trial_start,
        trial_end: liveSubscription.trial_end,
        current_period_start: liveSubscription.current_period_start,
        current_period_end: liveSubscription.current_period_end,
        cancel_at_period_end: liveSubscription.cancel_at_period_end,
        entitlement_snapshot: entitlement,
        provider_verified_at: now,
        provider_modified_at: providerModifiedAt,
        updated_at: providerModifiedAt,
      })
      .eq("id", subscription.id)
      .eq("workspace_id", workspaceId);

    if (subscriptionUpdateError) {
      throw new Error("Verified subscription state could not be saved.");
    }

    const { error: workspaceUpdateError } = await supabase
      .from("workspaces")
      .update({ entitlement_type: entitlement })
      .eq("id", workspaceId);
    if (workspaceUpdateError) {
      throw new Error("Verified workspace entitlement could not be saved.");
    }

    return entitlement;
  }

  /**
   * Retrieves verified billing details for a workspace.
   */
  async getBillingDetails(
    workspaceId: string,
    supabaseOverride?: any
  ): Promise<BillingDetails> {
    const supabase = supabaseOverride || createServiceClient();
    const entitlement = await this.getVerifiedWorkspaceEntitlement(workspaceId, supabase);

    const { data: subscription, error: subscriptionError } = await supabase
      .from("subscriptions")
      .select("polar_subscription_id, status, trial_end, current_period_end, cancel_at_period_end")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subscriptionError) {
      throw new Error("Billing subscription details could not be loaded.");
    }

    const accessMode = entitlement === "internal_beta" ? "private_beta" : "commercial";

    return {
      planName: "Nunuza Solo",
      amount: 29,
      currency: "USD",
      interval: "month",
      trialDays: 14,
      isTrialRequired: true,
      accessMode,
      entitlement,
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


// Reuse one server-side Polar service instance across billing and worker gates.
let polarServiceInstance: PolarService | null = null;
export function getPolarService(): PolarService {
  if (!polarServiceInstance) polarServiceInstance = new PolarService();
  return polarServiceInstance;
}
