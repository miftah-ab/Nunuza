import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Nunuza Terms of Service.",
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <div className="py-16 md:py-24">
      <div className="container-narrow">
        <div className="mb-10">
          <p className="section-label mb-2">Legal</p>
          <h1 className="text-3xl font-bold text-ink tracking-tight">
            Terms of Service
          </h1>
          <p className="mt-3 text-sm text-ink-secondary">
            Last updated: November 2026 · Nunuza v1.0.0.
          </p>
        </div>

        <div className="prose-like space-y-8 text-sm text-ink-secondary leading-relaxed">
          <section aria-labelledby="terms-acceptance">
            <h2 id="terms-acceptance" className="text-base font-semibold text-ink mb-3">
              Acceptance
            </h2>
            <p>
              By signing in to Nunuza, you agree to these terms. If you do not
              agree, do not use the service.
            </p>
          </section>

          <section aria-labelledby="terms-service">
            <h2 id="terms-service" className="text-base font-semibold text-ink mb-3">
              The service
            </h2>
            <p>
              Nunuza is an autonomous LinkedIn content operations agent. It supports
              strategic planning, AI content drafting, human review, background scheduling,
              and direct personal-profile publishing via official LinkedIn APIs. Access is
              available through commercial 14-day free trials ($29/month) or authorized
              private beta access.
            </p>
          </section>

          <section aria-labelledby="terms-acceptable-use">
            <h2 id="terms-acceptable-use" className="text-base font-semibold text-ink mb-3">
              Acceptable use
            </h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>Use Nunuza only in compliance with LinkedIn&apos;s Terms of Service.</li>
              <li>Do not attempt to bypass platform restrictions or API limits.</li>
              <li>Do not use Nunuza for automated connection requests, mass messages, or engagement farming.</li>
              <li>Do not submit content that violates applicable laws or the rights of others.</li>
            </ul>
          </section>

          <section aria-labelledby="terms-content">
            <h2 id="terms-content" className="text-base font-semibold text-ink mb-3">
              Your content
            </h2>
            <p>
              Your drafts and content belong to you. You can export them at any
              time. You grant Nunuza a limited license to store and process your
              content to provide the service.
            </p>
          </section>

          <section aria-labelledby="terms-billing">
            <h2 id="terms-billing" className="text-base font-semibold text-ink mb-3">
              Billing &amp; Access
            </h2>
            <p>
              Commercial subscriptions start with a 14-day free trial. A valid payment card
              is required at checkout. The trial converts automatically to $29.00 USD/month
              after 14 days unless canceled. You may cancel at any time from your billing dashboard
              without penalty. Authorized private beta testers access the service without payment
              cards or fees under terms established with administrators.
            </p>
          </section>

          <section aria-labelledby="terms-liability">
            <h2 id="terms-liability" className="text-base font-semibold text-ink mb-3">
              Limitation of liability
            </h2>
            <p>
              Nunuza is provided &ldquo;as is&rdquo; during this preview period. We make no
              guarantees about availability, performance, or specific outcomes.
              We are not liable for any indirect, incidental, or consequential
              damages. Our liability is limited to the amount you paid us in the
              12 months preceding the claim, if any.
            </p>
          </section>

          <section aria-labelledby="terms-changes">
            <h2 id="terms-changes" className="text-base font-semibold text-ink mb-3">
              Changes
            </h2>
            <p>
              These terms may be updated before public launch. Significant
              changes will be communicated to registered users.
            </p>
          </section>
        </div>

        <div className="mt-10 pt-6 border-t border-border">
          <Link href="/" className="text-sm text-forest hover:text-forest-hover">
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
