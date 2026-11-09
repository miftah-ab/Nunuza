import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Nunuza handles your data.",
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <div className="py-16 md:py-24">
      <div className="container-narrow">
        {/* Header */}
        <div className="mb-10">
          <p className="section-label mb-2">Legal</p>
          <h1 className="text-3xl font-bold text-ink tracking-tight">
            Privacy Policy
          </h1>
          <p className="mt-3 text-sm text-ink-secondary">
            Last updated: November 2026 · Nunuza v1.0.0.
          </p>
        </div>

        <div className="prose-like space-y-8 text-sm text-ink-secondary leading-relaxed">
          <section aria-labelledby="privacy-overview">
            <h2 id="privacy-overview" className="text-base font-semibold text-ink mb-3">
              Overview
            </h2>
            <p>
              Nunuza (&ldquo;we&rdquo;, &ldquo;our&rdquo;, &ldquo;the service&rdquo;) is an autonomous LinkedIn
              content operations SaaS for solo founders. This policy explains what
              data we collect, why we collect it, and how it is securely handled.
            </p>
          </section>

          <section aria-labelledby="privacy-data-collected">
            <h2 id="privacy-data-collected" className="text-base font-semibold text-ink mb-3">
              Data we collect
            </h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>
                <strong className="text-ink">Account data:</strong> Your Google
                account name, email address, and profile picture, provided when
                you sign in with Google via Supabase Auth.
              </li>
              <li>
                <strong className="text-ink">Content you create:</strong> Draft
                text, strategy settings, voice preferences, and content notes
                you enter in the dashboard.
              </li>
              <li>
                <strong className="text-ink">Usage data:</strong> Draft creation
                counts, job status records, and onboarding progress.
              </li>
              <li>
                <strong className="text-ink">Operational logs:</strong> Redacted
                error logs and job audit events. Logs do not contain your draft
                text or credentials.
              </li>
            </ul>
          </section>

          <section aria-labelledby="privacy-providers">
            <h2 id="privacy-providers" className="text-base font-semibold text-ink mb-3">
              Third-party providers
            </h2>
            <ul className="space-y-2 list-disc list-inside">
              <li>
                <strong className="text-ink">Supabase:</strong> Database and
                authentication. Your data is stored in Supabase PostgreSQL.
              </li>
              <li>
                <strong className="text-ink">Cloudflare:</strong> Hosting and
                serverless compute.
              </li>
              <li>
                <strong className="text-ink">AI providers (Groq / OpenRouter):</strong>{" "}
                When generating content, we send your strategy context and voice
                preferences to an AI provider. We send the minimum context
                needed. We do not send secrets or unrelated workspace data to AI
                providers.
              </li>
              <li>
                <strong className="text-ink">LinkedIn:</strong> When you connect
                your LinkedIn account, OAuth tokens are encrypted at rest using
                AES-256-GCM. We never send your LinkedIn token to the browser.
              </li>
              <li>
                <strong className="text-ink">Polar:</strong> Merchant of Record
                for commercial billing and payment card processing. Payment card
                details are handled directly by Polar and never enter our servers.
              </li>
            </ul>
          </section>

          <section aria-labelledby="privacy-retention">
            <h2 id="privacy-retention" className="text-base font-semibold text-ink mb-3">
              Data retention and deletion
            </h2>
            <p>
              You can export your drafts and content at any time from the
              dashboard. You can request account deletion from Settings. On
              deletion, your workspace data and credentials are scheduled for
              removal according to our documented retention policy. Some records
              may be retained as required by applicable law or accounting
              obligations.
            </p>
            <p className="mt-3">
              A formal retention policy will be documented before any public
              paid launch. We will not claim a specific retention period until
              it is decided and documented.
            </p>
          </section>

          <section aria-labelledby="privacy-contact">
            <h2 id="privacy-contact" className="text-base font-semibold text-ink mb-3">
              Contact
            </h2>
            <p>
              Questions about this policy? Contact the Nunuza team at the
              address provided in the dashboard after signing in.
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
