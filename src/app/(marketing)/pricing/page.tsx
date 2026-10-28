import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Info } from "lucide-react";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Nunuza Solo — one plan at $29/month with a 14-day trial. Available after all paid-launch gates pass. Currently in draft-only preview at no charge.",
};

const includedFeatures = [
  "One personal LinkedIn profile",
  "One active content strategy",
  "Structured voice profile with writing samples",
  "Up to 30 new draft items per billing month",
  "Content version history",
  "Draft export in portable format",
  "Dashboard controls",
  "Telegram controls (after Telegram gate passes)",
  "Remote MCP read and control tools (after MCP gate passes)",
  "Bounded Autopilot — paid workspaces only, after all gates pass",
  "Activity log with job audit trail",
];

const notIncluded = [
  "Multiple workspaces or team seats",
  "Multiple LinkedIn accounts per workspace",
  "Company/organization page publishing",
  "Image, video, or carousel posts",
  "Annual billing or lifetime plans",
  "Usage overages or add-ons",
];

export default function PricingPage() {
  return (
    <div className="py-20 md:py-28">
      <div className="container-page max-w-3xl">
        {/* Header */}
        <div className="text-center mb-14">
          <p className="section-label mb-3">Pricing</p>
          <h1 className="text-4xl font-bold text-ink tracking-tight">
            One plan. No surprises.
          </h1>
          <p className="mt-4 text-lg text-ink-secondary max-w-xl mx-auto">
            The draft-only preview is free with no payment card. The Nunuza
            Solo paid plan becomes available after all required capability and
            paid-launch gates pass.
          </p>
        </div>

        {/* Current state banner */}
        <div className="card border-forest-muted bg-forest-light p-5 flex gap-3 mb-8">
          <Info size={18} className="text-forest flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-ink mb-1">
              Currently in draft-only preview
            </p>
            <p className="text-sm text-ink-secondary">
              Checkout is not available. Sign up with Google for free draft
              access — no payment card required. Paid launch will be enabled
              when every required gate passes.
            </p>
          </div>
        </div>

        {/* Pricing card */}
        <div className="card p-8 mb-8">
          {/* Plan header */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 pb-6 border-b border-border">
            <div>
              <h2 className="text-xl font-bold text-ink">Nunuza Solo</h2>
              <p className="text-sm text-ink-secondary mt-1">
                Everything you need to run a LinkedIn content workflow.
              </p>
            </div>
            <div className="sm:text-right">
              <div className="flex items-end gap-1 sm:justify-end">
                <span className="text-4xl font-bold text-ink">$29</span>
                <span className="text-sm text-ink-secondary pb-1">/ month</span>
              </div>
              <p className="text-xs text-ink-secondary mt-1">
                14-day trial · card required · then $29/month
              </p>
            </div>
          </div>

          {/* Included */}
          <div className="pt-6">
            <h3 className="text-xs font-semibold text-ink-secondary uppercase tracking-widest mb-4">
              Included
            </h3>
            <ul className="space-y-2.5" role="list">
              {includedFeatures.map((feature) => (
                <li key={feature} className="flex items-start gap-2.5 text-sm text-ink">
                  <CheckCircle2
                    size={15}
                    className="text-success flex-shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          {/* Not included */}
          <div className="pt-6 mt-6 border-t border-border">
            <h3 className="text-xs font-semibold text-ink-secondary uppercase tracking-widest mb-4">
              Not included in v1
            </h3>
            <ul className="space-y-2.5" role="list">
              {notIncluded.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-ink-secondary">
                  <span className="w-3.5 h-3.5 rounded-full border border-border flex-shrink-0 mt-0.5" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* CTA */}
          <div className="mt-8 pt-6 border-t border-border">
            <div className="rounded-lg bg-offwhite border border-border px-4 py-4 text-center">
              <p className="text-sm font-medium text-ink mb-1">
                Checkout not available — draft-only preview
              </p>
              <p className="text-xs text-ink-secondary mb-3">
                Sign up free with Google to access the draft-only preview.
              </p>
              <Link
                href="/login"
                id="pricing-cta"
                className="btn-primary text-sm"
              >
                Try the draft-only preview — free
              </Link>
            </div>
          </div>
        </div>

        {/* Trial and billing terms */}
        <div className="card p-6 bg-offwhite">
          <h3 className="text-sm font-semibold text-ink mb-3">
            Trial and billing terms (applies after paid launch)
          </h3>
          <ul className="space-y-2 text-sm text-ink-secondary" role="list">
            <li>
              <strong className="text-ink">Trial:</strong> 14 days. A payment
              card is required at trial start. You will not be charged during
              the trial period.
            </li>
            <li>
              <strong className="text-ink">Renewal:</strong> $29/month,
              automatically billed after the trial unless canceled. Renewal
              amount and first charge date are shown before checkout
              confirmation.
            </li>
            <li>
              <strong className="text-ink">Cancellation:</strong> Cancel any
              time before renewal from the billing page. Access continues
              through the paid-through period.
            </li>
            <li>
              <strong className="text-ink">Failed payment:</strong> Nunuza
              follows Polar&apos;s recovery process. Your drafts and exports remain
              accessible. New publishing jobs are paused until payment is
              resolved.
            </li>
            <li>
              <strong className="text-ink">Usage limits:</strong> Up to 30 new
              draft items per billing month. Hard cap of one scheduled post per
              calendar day and seven per rolling seven-day period. Users cannot
              raise these caps.
            </li>
          </ul>
          <p className="mt-4 text-xs text-ink-secondary">
            These terms describe the future paid plan, not the current free
            draft-only preview. No charges apply during the preview.
          </p>
        </div>
      </div>
    </div>
  );
}
