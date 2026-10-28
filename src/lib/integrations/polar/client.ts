/**
 * Polar Billing Client & Configuration.
 *
 * Implements BED-08 & Spec §12:
 * - Single commercial offer: Nunuza Solo at $29/month with 14-day card-required trial
 * - Server-side only; never exposes tokens or secrets to client
 * - Seller eligibility gate: checkout remains fail-closed if seller is ineligible
 * - Supports Polar sandbox and production environments
 */

import type { CheckoutSessionOptions, CheckoutSessionResult, PolarConfig } from "./types";

export const NUNUZA_SOLO_PLAN = {
  name: "Nunuza Solo",
  amountMonthly: 29,
  currency: "USD",
  trialDays: 14,
  cardRequired: true,
} as const;

export class PolarClient {
  private readonly accessToken: string;
  private readonly productId: string;
  private readonly priceId: string;
  private readonly server: "sandbox" | "production";

  constructor(config?: Partial<PolarConfig>) {
    this.accessToken = config?.accessToken ?? process.env.POLAR_ACCESS_TOKEN ?? "";
    this.productId = config?.productId ?? process.env.POLAR_PRODUCT_ID ?? "";
    this.priceId = config?.priceId ?? process.env.POLAR_PRICE_ID ?? "";

    const envServer = process.env.POLAR_SERVER?.toLowerCase();
    if (envServer === "production") {
      this.server = "production";
    } else {
      this.server = "sandbox";
    }
  }

  getApiBaseUrl(): string {
    return this.server === "production"
      ? "https://api.polar.sh/v1"
      : "https://sandbox-api.polar.sh/v1";
  }

  /**
   * Verifies that the required environment variables are configured.
   */
  isConfigured(): boolean {
    return Boolean(
      this.accessToken &&
      this.accessToken.trim().length > 0 &&
      !this.accessToken.includes("your-polar") &&
      this.productId &&
      !this.productId.includes("your-polar") &&
      this.priceId &&
      !this.priceId.includes("your-polar")
    );
  }

  /**
   * Validates seller eligibility and paid-launch readiness (BED-08).
   * Live checkout must remain disabled until the legally responsible seller is verified.
   */
  isSellerEligible(): boolean {
    // Check explicit seller readiness flag; defaults to false in development/pre-release
    return process.env.POLAR_SELLER_ELIGIBLE === "true";
  }

  /**
   * Creates a checkout session for Nunuza Solo ($29/mo, 14-day trial).
   * Throws if seller is ineligible or Polar configuration is incomplete.
   */
  async createCheckoutSession(
    options: CheckoutSessionOptions
  ): Promise<CheckoutSessionResult> {
    if (!this.isConfigured()) {
      throw new Error(
        "BILLING_UNCONFIGURED: Polar billing credentials or price IDs are not configured."
      );
    }

    if (!this.isSellerEligible()) {
      throw new Error(
        "SELLER_INELIGIBLE: Live Polar checkout is disabled pending legally eligible seller onboarding (BED-08)."
      );
    }

    const payload = {
      product_price_id: this.priceId,
      customer_email: options.userEmail,
      metadata: {
        workspace_id: options.workspaceId,
      },
      success_url: options.successUrl,
    };

    const response = await fetch(`${this.getApiBaseUrl()}/checkouts/custom/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Polar checkout creation failed (${response.status}): ${errorText.slice(0, 200)}`);
    }

    const json = (await response.json()) as { url?: string; id?: string };
    if (!json.url) {
      throw new Error("Polar did not return a valid checkout URL.");
    }

    return {
      checkoutUrl: json.url,
      sessionId: json.id,
    };
  }

  /**
   * Queries Polar for a customer's active subscription (server-to-server).
   */
  async getSubscription(subscriptionId: string): Promise<any> {
    if (!this.isConfigured()) {
      throw new Error("Polar is not configured.");
    }

    const response = await fetch(
      `${this.getApiBaseUrl()}/subscriptions/${encodeURIComponent(subscriptionId)}`,
      {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch Polar subscription (${response.status}): ${errorText.slice(0, 200)}`);
    }

    return await response.json();
  }
}
