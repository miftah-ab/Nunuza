/**
 * Polar Webhook Endpoint.
 *
 * Receives and processes real-time subscription lifecycle webhooks from Polar.
 * Verifies cryptographic signatures, enforces idempotency, and updates entitlements.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyPolarWebhookSignature } from "@/lib/integrations/polar/crypto";
import { PolarService } from "@/lib/integrations/polar/service";
import type { PolarWebhookEvent } from "@/lib/integrations/polar/types";

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    const headers = {
      id: req.headers.get("webhook-id"),
      timestamp: req.headers.get("webhook-timestamp"),
      signature: req.headers.get("webhook-signature"),
    };

    // 1. Cryptographic Signature Verification
    const isAuthentic = verifyPolarWebhookSignature(rawBody, headers);
    if (!isAuthentic) {
      return NextResponse.json(
        { error: "Unauthorized: Invalid webhook signature or timestamp expired." },
        { status: 401 }
      );
    }

    // 2. Parse event payload safely
    let event: PolarWebhookEvent;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Bad Request: Malformed JSON payload." },
        { status: 400 }
      );
    }

    // 3. Process subscription event idempotently
    const service = new PolarService();
    const result = await service.processWebhookEvent(event);

    return NextResponse.json({
      received: true,
      status: result.status,
      reason: result.reason,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Internal Server Error", message: err.message },
      { status: 500 }
    );
  }
}
