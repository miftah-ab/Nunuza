"use client";

import { useState } from "react";
import type { BillingDetails } from "@/lib/integrations/polar/types";
import { CheckCircle2, AlertCircle, Shield, CreditCard, Sparkles } from "lucide-react";

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
        throw new Error(data.message || data.error || "Checkout unavailable");
      }
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getBadge = () => {
    switch (details.entitlement) {
      case "draft_only":
        return {
          title: "Draft-only preview — no subscription required",
          variant: "bg-surface text-ink-secondary border-border",
          desc: "You have free access to draft planning, AI generation, and export. No payment card is required.",
        };
      case "publishing_beta":
        return {
          title: "LinkedIn publishing beta — no subscription required",
          variant: "bg-brand/10 text-brand border-brand/20",
          desc: "You are part of the exclusive test cohort with authorized human-approved publishing.",
        };
      case "internal_test":
        return {
          title: "Internal acceptance test",
          variant: "bg-amber-500/10 text-amber-600 border-amber-500/20",
          desc: "Restricted administrative acceptance testing workspace.",
        };
      case "paid_trial":
        return {
          title: "14-Day Trial Active",
          variant: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
          desc: `Your trial is active. Renews at $29/mo${details.subscription?.trialEnd ? ` on ${new Date(details.subscription.trialEnd).toLocaleDateString()}` : ""}.`,
        };
      case "paid_active":
        return {
          title: "Nunuza Solo — Active ($29/mo)",
          variant: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
          desc: `Subscribed. Next billing date: ${details.subscription?.currentPeriodEnd ? new Date(details.subscription.currentPeriodEnd).toLocaleDateString() : "Next month"}.`,
        };
      case "inactive":
        return {
          title: "Subscription Inactive",
          variant: "bg-rose-500/10 text-rose-600 border-rose-500/20",
          desc: "Your subscription has ended. Content export and viewing remain available.",
        };
      default:
        return {
          title: details.entitlement,
          variant: "bg-surface text-ink",
          desc: "",
        };
    }
  };

  const badge = getBadge();
  const isPaid = details.entitlement === "paid_trial" || details.entitlement === "paid_active";

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Current Status Card */}
      <div className="card p-6 border bg-surface-raised shadow-xs rounded-xl">
        <div className="flex items-start justify-between">
          <div>
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${badge.variant}`}
            >
              {badge.title}
            </span>
            <p className="mt-3 text-sm text-ink-secondary">{badge.desc}</p>
          </div>
          {isPaid && (
            <div className="text-right">
              <span className="text-xs text-ink-muted block">Billed via</span>
              <span className="text-sm font-semibold text-ink">Polar Merchant of Record</span>
            </div>
          )}
        </div>
      </div>

      {/* Plan Card */}
      <div className="card p-6 border rounded-xl bg-surface space-y-6">
        <div className="flex items-baseline justify-between border-b pb-4">
          <div>
            <h2 className="text-xl font-bold text-ink">Nunuza Solo</h2>
            <p className="text-sm text-ink-secondary mt-1">
              Full autonomous LinkedIn content operations agent for solo founders.
            </p>
          </div>
          <div className="text-right">
            <span className="text-3xl font-extrabold text-ink">$29</span>
            <span className="text-sm text-ink-muted"> / month</span>
          </div>
        </div>

        {/* Feature List */}
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2 text-ink">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>AI Draft Generation (Groq LLM)</span>
          </div>
          <div className="flex items-center gap-2 text-ink">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>Strategic Monthly Content Plans</span>
          </div>
          <div className="flex items-center gap-2 text-ink">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>LinkedIn Scheduling & Publishing</span>
          </div>
          <div className="flex items-center gap-2 text-ink">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>Telegram Bot Control</span>
          </div>
          <div className="flex items-center gap-2 text-ink">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>Remote MCP Server Integration</span>
          </div>
          <div className="flex items-center gap-2 text-ink">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>Autopilot Mode (Bounded Safety)</span>
          </div>
        </div>

        {/* Legal Disclosures before Checkout */}
        <div className="p-4 rounded-lg bg-surface-raised border text-xs text-ink-secondary space-y-2">
          <div className="flex items-center gap-1.5 font-semibold text-ink">
            <Shield className="w-4 h-4 text-brand" />
            <span>Trial &amp; Renewal Disclosures</span>
          </div>
          <ul className="list-disc pl-4 space-y-1">
            <li>14-day free trial requires a valid credit/debit card at checkout.</li>
            <li>Converts to $29.00 USD/month automatically after 14 days unless canceled.</li>
            <li>Cancel anytime before the trial ends in this dashboard without being charged.</li>
            <li>Payments processed securely by Polar as Merchant of Record.</li>
          </ul>
        </div>

        {/* Action Button & Error State */}
        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {!isPaid && (
          <div>
            <button
              onClick={handleStartTrial}
              disabled={loading}
              className="btn btn-primary w-full py-2.5 flex items-center justify-center gap-2 text-sm font-semibold"
            >
              {loading ? (
                "Processing..."
              ) : (
                <>
                  <CreditCard className="w-4 h-4" />
                  <span>Start 14-Day Free Trial ($29/mo after)</span>
                </>
              )}
            </button>
            {!details.isSellerEligible && (
              <p className="mt-2 text-xs text-center text-ink-muted">
                Note: Live checkout is currently disabled pending seller onboarding (BED-08). Free draft preview is fully enabled.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
