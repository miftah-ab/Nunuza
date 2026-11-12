"use client";
import { userFacingError } from "@/lib/ui/error-message";

import { useState } from "react";
import type { BillingDetails } from "@/lib/integrations/polar/types";
import { CheckCircle2, AlertCircle, Shield, CreditCard, Sparkles, ExternalLink } from "lucide-react";

interface BillingClientProps {
  details: BillingDetails;
}

export function BillingClient({ details }: BillingClientProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStartTrial = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
      });
      const data = (await res.json()) as { message?: string; error?: string; checkoutUrl?: string };
      if (!res.ok) {
        throw new Error(data.message || data.error || "We couldn’t start checkout. Please try again.");
      }
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch (err: any) {
      setError(userFacingError(err, "We couldn’t start checkout. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const getStatusBanner = () => {
    switch (details.entitlement) {
      case "internal_beta":
        return {
          label: "Private Beta — Full Access",
          className: "notice-info",
          textClass: "text-forest",
          desc: "This workspace is authorized for private beta testing with full v1.0.0 features. No subscription or payment card required.",
        };
      case "paid_trial":
        return {
          label: "14-Day Trial Active",
          className: "notice-info",
          textClass: "text-forest",
          desc: `Your trial is active. Renews at $29/mo${details.subscription?.trialEnd ? ` on ${new Date(details.subscription.trialEnd).toLocaleDateString()}` : ""}.`,
        };
      case "paid_active":
        return {
          label: "Nunuza Solo — Active ($29/mo)",
          className: "notice-info",
          textClass: "text-forest",
          desc: `Subscribed. Next billing date: ${details.subscription?.currentPeriodEnd ? new Date(details.subscription.currentPeriodEnd).toLocaleDateString() : "Next month"}.`,
        };
      case "suspended":
        return {
          label: "Subscription Suspended",
          className: "notice-error",
          textClass: "text-error",
          desc: "Your subscription is suspended. Update your payment method via Polar to restore publishing and automation.",
        };
      case "expired":
        return {
          label: "Trial Expired",
          className: "notice-error",
          textClass: "text-error",
          desc: "Your 14-day free trial has expired. Subscribe to Nunuza Solo ($29/mo) to reactivate publishing and automation.",
        };
      case "inactive":
        return {
          label: "Subscription Inactive",
          className: "notice-error",
          textClass: "text-error",
          desc: "Your subscription has ended. Content export and viewing remain available.",
        };
      default:
        return {
          label: "Start Your Trial",
          className: "notice-warning",
          textClass: "text-warning",
          desc: "Start your 14-day free trial (credit card required) to activate full LinkedIn publishing, scheduling, and Autopilot.",
        };
    }
  };

  const statusBanner = getStatusBanner();
  const isPrivateBeta =
    details.accessMode === "private_beta" ||
    details.entitlement === "internal_beta";
  const isPaid = details.entitlement === "paid_trial" || details.entitlement === "paid_active";

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Status banner */}
      <div className={statusBanner.className}>
        <div className="flex items-start gap-3">
          {isPrivateBeta ? (
            <Sparkles size={16} className="shrink-0 mt-0.5 text-forest" />
          ) : isPaid ? (
            <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-forest" />
          ) : (
            <AlertCircle size={16} className={`shrink-0 mt-0.5 ${statusBanner.textClass}`} />
          )}
          <div>
            <p className={`text-sm font-semibold ${statusBanner.textClass}`}>{statusBanner.label}</p>
            <p className="text-sm text-ink-secondary mt-0.5">{statusBanner.desc}</p>
          </div>
        </div>
      </div>

      {/* Plan card */}
      <div className="card p-6 space-y-6">
        <div className="flex items-baseline justify-between pb-5 border-b border-border">
          <div>
            <h2 className="text-lg font-bold text-ink">Nunuza Solo</h2>
            <p className="text-sm text-ink-secondary mt-1">
              Full autonomous LinkedIn content operations for solo founders.
            </p>
          </div>
          <div className="text-right shrink-0 ml-6">
            <span className="text-3xl font-extrabold text-ink leading-none">$29</span>
            <span className="text-sm text-ink-muted block mt-1">/ month</span>
          </div>
        </div>

        {/* Feature list */}
        <div className="grid sm:grid-cols-2 gap-2.5">
          {[
            "AI Draft Generation",
            "Strategic Monthly Content Plans",
            "LinkedIn Scheduling & Publishing",
            "Telegram Bot Control",
            "Remote MCP Server Integration",
            "Bounded Autopilot (Hard Safety Caps)",
          ].map((item) => (
            <div key={item} className="flex items-center gap-2 text-sm text-ink">
              <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
              <span>{item}</span>
            </div>
          ))}
        </div>

        {/* Legal disclosures */}
        <div className="p-4 rounded-lg bg-surface border border-border">
          <div className="flex items-center gap-1.5 mb-2">
            <Shield className="w-4 h-4 text-forest" />
            <span className="text-sm font-semibold text-ink">Trial &amp; Renewal Disclosures</span>
          </div>
          <ul className="space-y-1 text-xs text-ink-secondary">
            <li>• 14-day free trial requires a valid credit/debit card at checkout.</li>
            <li>• Converts to $29.00 USD/month automatically after 14 days unless canceled.</li>
            <li>• Cancel anytime before the trial ends in this dashboard without being charged.</li>
            <li>• Payments processed securely by Polar as Merchant of Record.</li>
          </ul>
        </div>

        {/* Error state */}
        {error && (
          <div className="notice-error flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-error" />
            <span className="text-sm text-error">{error}</span>
          </div>
        )}

        {/* CTA */}
        {isPrivateBeta ? (
          <div className="notice-info flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-forest" />
            <div>
              <p className="text-sm font-semibold text-forest">Private Beta Access Active</p>
              <p className="text-sm text-ink-secondary mt-0.5">
                Your workspace is enrolled in the private beta with full v1.0.0 capabilities. No payment card or checkout required.
              </p>
            </div>
          </div>
        ) : isPaid ? (
          <div className="flex items-center justify-between p-4 bg-surface rounded-lg border border-border">
            <div>
              <p className="text-sm font-medium text-ink">Manage subscription</p>
              <p className="text-xs text-ink-secondary mt-0.5">Billing managed by Polar — Merchant of Record.</p>
            </div>
            <span className="text-xs text-ink-muted flex items-center gap-1">
              Polar <ExternalLink size={12} />
            </span>
          </div>
        ) : (
          <div>
            <button
              onClick={handleStartTrial}
              disabled={loading}
              className="btn-primary w-full py-3 justify-center text-sm font-semibold"
            >
              {loading ? (
                "Processing…"
              ) : (
                <>
                  <CreditCard className="w-4 h-4" />
                  <span>Start 14-Day Free Trial ($29/mo after)</span>
                </>
              )}
            </button>
            {!details.isSellerEligible && (
              <p className="mt-2 text-xs text-center text-ink-muted">
                Note: Live checkout is currently in test mode pending seller onboarding.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
