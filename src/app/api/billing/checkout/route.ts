/**
 * Polar Checkout Session Creation API.
 *
 * Implements Nunuza Solo checkout with 14-day card-required trial.
 * Strictly checks seller eligibility and paid-launch gates before redirecting.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { createClient } from "@/lib/supabase/server";
import { PolarClient } from "@/lib/integrations/polar/client";
import { getPolarService } from "@/lib/integrations/polar/service";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const workspace = await requireWorkspace();
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !user.email) {
      return NextResponse.json({ error: "We couldn’t verify your account details. Please sign in again." }, { status: 400 });
    }

    const polarClient = new PolarClient();

    // Reconcile the provider's current state before creating another checkout.
    // This prevents duplicate active subscriptions and keeps private-beta users
    // outside the commercial billing flow.
    let currentEntitlement;
    try {
      currentEntitlement = await getPolarService().getVerifiedWorkspaceEntitlement(workspace.id);
    } catch (verificationError) {
      console.error("[billing] Could not verify existing subscription:", verificationError);
      return NextResponse.json(
        { error: "We couldn’t verify your current billing status. Please try again shortly." },
        { status: 503 }
      );
    }

    if (currentEntitlement === "internal_beta") {
      return NextResponse.json(
        { error: "Private beta workspaces do not need a paid subscription." },
        { status: 403 }
      );
    }
    if (currentEntitlement === "paid_trial" || currentEntitlement === "paid_active") {
      return NextResponse.json(
        { error: "This workspace already has an active subscription. Manage it from Billing instead of starting another checkout." },
        { status: 409 }
      );
    }

    const service = createServiceClient();
    const { data: billingCustomer, error: billingCustomerError } = await service
      .from("billing_customers")
      .select("polar_customer_id")
      .eq("workspace_id", workspace.id)
      .maybeSingle();
    if (billingCustomerError) {
      console.error("[billing] Could not load existing Polar customer mapping:", billingCustomerError);
      return NextResponse.json(
        { error: "We couldn’t prepare checkout. Please try again shortly." },
        { status: 503 }
      );
    }

    // 1. Seller Eligibility & Launch Gate Check (BED-08)
    if (!polarClient.isSellerEligible()) {
      console.warn("[billing] Checkout is unavailable for the current seller configuration.");
      return NextResponse.json(
        {
          error: "Billing is temporarily unavailable. Please try again later or contact support.",
        },
        { status: 403 }
      );
    }

    if (!polarClient.isConfigured()) {
      console.error("[billing] Checkout provider configuration is incomplete.");
      return NextResponse.json(
        {
          error: "We can’t start checkout right now. Please try again later.",
        },
        { status: 503 }
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const successUrl = `${appUrl}/app/billing?checkout=success`;

    // 2. Initiate Polar Checkout
    const result = await polarClient.createCheckoutSession({
      workspaceId: workspace.id,
      userEmail: user.email,
      customerId: billingCustomer?.polar_customer_id ?? null,
      successUrl,
    });

    return NextResponse.json({
      checkoutUrl: result.checkoutUrl,
      sessionId: result.sessionId,
    });
  } catch (err) {
    console.error("[billing] Checkout request failed:", err);
    return NextResponse.json({ error: "We couldn’t start checkout. Please try again. If the problem continues, contact support." }, { status: 500 });
  }
}
