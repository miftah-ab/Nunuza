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
