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
      return NextResponse.json({ error: "User email not found." }, { status: 400 });
    }

    const polarClient = new PolarClient();

    // 1. Seller Eligibility & Launch Gate Check (BED-08)
    if (!polarClient.isSellerEligible()) {
      return NextResponse.json(
        {
          error: "SELLER_INELIGIBLE",
          message:
            "Live checkout is currently disabled pending legally responsible adult seller onboarding (BED-08). Public preview drafting remains unrestricted.",
        },
        { status: 403 }
      );
    }

    if (!polarClient.isConfigured()) {
      return NextResponse.json(
        {
          error: "BILLING_UNCONFIGURED",
          message: "Polar billing credentials or price IDs are not configured.",
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
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to create checkout session." },
      { status: 500 }
    );
  }
}
