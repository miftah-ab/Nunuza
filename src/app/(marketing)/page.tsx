import type { Metadata } from "next";
import Link from "next/link";
import {
  FileText,
  Mic2,
  ClipboardCheck,
  Download,
  ArrowRight,
  CheckCircle2,
  Lock,
  Info,
  ChevronDown,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Nunuza — LinkedIn content operations for founders",
  description:
    "Your LinkedIn strategy, voice, and drafts in one workflow. Plan and refine LinkedIn posts in a reviewable dashboard. Draft-only preview — no subscription required.",
};

// ─── Data ──────────────────────────────────────────────────────────────────────

const workflowSteps = [
  {
    icon: Mic2,
    step: "01",
    title: "Define your voice and goals",
    description:
      "Set your content pillars, audience, professional positioning, and writing voice. Nunuza uses these preferences in every draft — consistently, without re-explaining yourself.",
  },
  {
    icon: FileText,
    step: "02",
    title: "Review generated drafts",
    description:
      "Nunuza generates text drafts grounded in your strategy. Every draft waits for your review before anything happens. You approve, revise, or reject — the agent never acts without you.",
  },
  {
    icon: ClipboardCheck,
    step: "03",
    title: "Refine to your standard",
    description:
      "Edit in the full-text editor, request an AI revision, or add your own notes. Version history preserves every state. No silent overwrites of your edits.",
  },
  {
    icon: Download,
    step: "04",
    title: "Export or copy your drafts",
    description:
      "Copy to clipboard or export your drafts in a portable format. Your content is yours regardless of subscription status.",
  },
];

const featureCards = [
  {
    title: "Persistent strategy",
    description:
      "Your audience, goals, content pillars, and voice preferences are stored and applied to every generation — not re-entered every session.",
  },
  {
    title: "Structured voice profile",
    description:
      "Set tone, sentence length, formality, phrases to use or avoid, and optional writing samples. The agent follows your defined style, not a generic AI voice.",
  },
  {
    title: "Approval-required workflow",
    description:
      "Every draft requires your explicit review and approval. Nothing publishes automatically in this preview. You are the final decision-maker.",
  },
  {
    title: "Version history",
    description:
      "Every edit and revision is preserved. You can see how a draft evolved and what changed at each step.",
  },
  {
    title: "Export in portable format",
    description:
      "Your drafts and content versions can be exported regardless of trial or subscription status, including after cancellation.",
  },
  {
    title: "Honest content limits",
    description:
      "Up to 30 new draft items per calendar month. No hidden overage charges. Usage and reset date are visible before you reach the limit.",
  },
];

const faqItems = [
  {
    q: "Do I need a payment card for the draft-only preview?",
    a: "No. The draft-only preview is free and requires no payment card. You sign up with Google and immediately get a workspace. Checkout and subscription are not enabled in this release.",
  },
  {
    q: "Can I publish to LinkedIn from the draft-only preview?",
    a: "No. This release supports drafting, reviewing, and exporting only. Publishing and scheduling are not available to draft-only workspaces. LinkedIn publishing will be enabled as a separate, limited beta after the required LinkedIn API access and acceptance-test gates pass.",
  },
  {
    q: "How much does it cost?",
    a: "The draft-only preview is free with no subscription. The future paid plan (Nunuza Solo) will be $29/month with a 14-day card-required trial, enabled only after all paid-launch gates pass. No checkout is available in this preview.",
  },
  {
    q: "What happens to my drafts if I stop using Nunuza?",
    a: "Your drafts can be exported in a portable format at any time, including after any future cancellation or expiration. Your content is yours.",
  },
  {
    q: "Does Nunuza post automatically?",
    a: "Not in this preview. Every draft requires your explicit approval. Autopilot is a future v1.0.0 feature that will be available only for paid workspaces after its own release gates pass, and only after you explicitly enable it.",
  },
  {
    q: "How do I share feedback or request updates?",
    a: "Use the feedback link in the dashboard or email the product team. Early feedback directly shapes which capabilities are prioritized.",
  },
];

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <>
      {/* ── 1 & 2. Hero ──────────────────────────────────────────────────── */}
      <section
        id="hero"
        aria-labelledby="hero-headline"
        className="bg-offwhite border-b border-border"
      >
        <div className="container-page py-20 md:py-28 text-center">
          {/* Stage label — honest about what this release is */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-forest-light border border-forest-muted text-forest text-xs font-semibold mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-forest inline-block" aria-hidden="true" />
            Draft-only preview — no subscription required
          </div>

          <h1
            id="hero-headline"
            className="text-4xl md:text-5xl font-bold text-ink leading-tight tracking-tight max-w-3xl mx-auto"
          >
            Your LinkedIn strategy, voice, and drafts in one workflow.
          </h1>

          <p className="mt-6 text-lg text-ink-secondary max-w-2xl mx-auto leading-relaxed">
            Plan and refine LinkedIn posts in a reviewable dashboard. This
            preview supports drafting and review. Publishing and scheduling are
            unavailable to draft-only workspaces.
          </p>

          {/* CTAs */}
          <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/login"
              id="hero-primary-cta"
              className="btn-primary text-base px-6 py-3"
            >
              Try the draft-only preview
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <a
              href="#how-it-works"
              id="hero-secondary-cta"
              className="btn-secondary text-base px-6 py-3"
            >
              See how it works
            </a>
          </div>

          {/* 3. Disclosure — shown only because live checkout is NOT enabled */}
          <p className="mt-6 text-xs text-ink-secondary">
            Free preview · No payment card · No publishing
          </p>
        </div>
      </section>

      {/* ── 4 & 5. Workflow section ──────────────────────────────────────── */}
      <section
        id="how-it-works"
        aria-labelledby="workflow-heading"
        className="py-20 md:py-28"
      >
        <div className="container-page">
          <div className="text-center mb-14">
            <p className="section-label mb-3">Draft-only preview workflow</p>
            <h2
              id="workflow-heading"
              className="text-3xl md:text-4xl font-bold text-ink tracking-tight"
            >
              From strategy to polished draft.
            </h2>
            <p className="mt-4 text-ink-secondary max-w-xl mx-auto">
              A controlled workflow that keeps your voice and strategy
              connected — without the manual coordination.
            </p>
          </div>

          <ol className="grid md:grid-cols-2 gap-6 list-none">
            {workflowSteps.map(({ icon: Icon, step, title, description }) => (
              <li key={step} className="card p-6 flex gap-4">
                <div
                  className="flex-shrink-0 w-10 h-10 rounded-lg bg-forest-light flex items-center justify-center"
                  aria-hidden="true"
                >
                  <Icon size={20} className="text-forest" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-ink-secondary mb-1">
                    Step {step}
                  </p>
                  <h3 className="text-base font-semibold text-ink mb-2">
                    {title}
                  </h3>
                  <p className="text-sm text-ink-secondary leading-relaxed">
                    {description}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── 6. Feature sections ──────────────────────────────────────────── */}
      <section
        id="features"
        aria-labelledby="features-heading"
        className="py-20 md:py-28 bg-offwhite border-y border-border"
      >
        <div className="container-page">
          <div className="text-center mb-14">
            <p className="section-label mb-3">What&apos;s included in the preview</p>
            <h2
              id="features-heading"
              className="text-3xl md:text-4xl font-bold text-ink tracking-tight"
            >
              Everything you need to draft well.
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {featureCards.map(({ title, description }) => (
              <article key={title} className="card p-5">
                <div className="flex items-start gap-2 mb-2">
                  <CheckCircle2
                    size={16}
                    className="text-success mt-0.5 flex-shrink-0"
                    aria-hidden="true"
                  />
                  <h3 className="text-sm font-semibold text-ink">{title}</h3>
                </div>
                <p className="text-sm text-ink-secondary leading-relaxed pl-6">
                  {description}
                </p>
              </article>
            ))}
          </div>

          {/* What's NOT in the preview — honest */}
          <div className="mt-8 card border-warning-light bg-warning-light/40 p-5 flex gap-3">
            <Info
              size={18}
              className="text-warning flex-shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-semibold text-ink mb-1">
                Not available in the draft-only preview
              </p>
              <p className="text-sm text-ink-secondary">
                Publishing, scheduling, Autopilot, and Telegram/MCP controls are
                not available in this release. Publishing will be enabled as a
                separate, limited beta after the required LinkedIn API access
                gates pass. Autopilot requires a paid subscription and additional
                release gates.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 7. How permissions and publishing work ───────────────────────── */}
      <section
        id="permissions"
        aria-labelledby="permissions-heading"
        className="py-20 md:py-28"
      >
        <div className="container-page max-w-3xl">
          <div className="text-center mb-10">
            <p className="section-label mb-3">How permissions work</p>
            <h2
              id="permissions-heading"
              className="text-3xl font-bold text-ink tracking-tight"
            >
              You are always in control.
            </h2>
            <p className="mt-4 text-ink-secondary">
              Nunuza never publishes without your explicit approval. Here&apos;s how
              each release stage works.
            </p>
          </div>

          <div className="space-y-4">
            <div className="card p-5 flex gap-4">
              <Lock
                size={18}
                className="text-forest flex-shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-semibold text-ink mb-1">
                  Draft-only preview (current)
                </p>
                <p className="text-sm text-ink-secondary">
                  Every public Google signup creates a workspace with{" "}
                  <strong>draft-only</strong> access. You can create, review,
                  revise, and export drafts. Scheduling and publishing are not
                  available. No payment card required.
                </p>
              </div>
            </div>

            <div className="card p-5 flex gap-4 opacity-70">
              <Lock
                size={18}
                className="text-ink-secondary flex-shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-semibold text-ink mb-1">
                  LinkedIn publishing beta{" "}
                  <span className="badge-beta ml-1">Coming later</span>
                </p>
                <p className="text-sm text-ink-secondary">
                  A limited cohort of explicitly provisioned workspaces will be
                  able to publish human-approved posts after LinkedIn API access
                  and acceptance-test gates pass. This stage is not available to
                  all users and is not the same as the paid plan.
                </p>
              </div>
            </div>

            <div className="card p-5 flex gap-4 opacity-70">
              <Lock
                size={18}
                className="text-ink-secondary flex-shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-semibold text-ink mb-1">
                  Nunuza Solo — paid plan{" "}
                  <span className="badge-beta ml-1">After all gates pass</span>
                </p>
                <p className="text-sm text-ink-secondary">
                  Full publishing, scheduling, Telegram, MCP controls, and
                  bounded Autopilot — enabled only after every required
                  capability gate passes. $29/month, 14-day card-required trial,
                  with clear renewal and cancellation terms before checkout.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 8. Pricing section ──────────────────────────────────────────── */}
      <section
        id="pricing"
        aria-labelledby="pricing-heading"
        className="py-20 md:py-28 bg-offwhite border-y border-border"
      >
        <div className="container-page max-w-2xl text-center">
          <p className="section-label mb-3">Pricing</p>
          <h2
            id="pricing-heading"
            className="text-3xl md:text-4xl font-bold text-ink tracking-tight"
          >
            Start free. Pay only when publishing is ready.
          </h2>
          <p className="mt-4 text-ink-secondary">
            The draft-only preview is free with no payment card. Checkout will
            be enabled after all required capability and paid-launch gates pass.
          </p>

          <div className="mt-10 card p-8 text-left">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <h3 className="text-lg font-bold text-ink">Nunuza Solo</h3>
                <p className="text-sm text-ink-secondary">One plan. Everything included.</p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-ink">$29</p>
                <p className="text-xs text-ink-secondary">/ month</p>
              </div>
            </div>

            <ul className="space-y-2.5 mb-6" role="list">
              {[
                "One personal LinkedIn profile",
                "One active content strategy",
                "Up to 30 new draft items per billing month",
                "Dashboard + Telegram + remote MCP controls",
                "Bounded Autopilot (paid workspaces only, after all gates pass)",
                "Full version history and draft export",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2.5 text-sm text-ink">
                  <CheckCircle2 size={15} className="text-success flex-shrink-0" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>

            {/* Checkout is disabled — honest label */}
            <div className="rounded-lg bg-offwhite border border-border px-4 py-3 text-sm text-ink-secondary text-center">
              Checkout not available in this release. Currently in draft-only preview.{" "}
              <Link href="/pricing" className="text-forest underline underline-offset-2">
                See full pricing details →
              </Link>
            </div>
          </div>

          <p className="mt-6 text-xs text-ink-secondary">
            14-day card-required trial after paid launch. Then $29/month unless
            canceled. Renewal amount and cancellation path shown before checkout.
          </p>
        </div>
      </section>

      {/* ── 9. FAQ ──────────────────────────────────────────────────────── */}
      <section
        id="faq"
        aria-labelledby="faq-heading"
        className="py-20 md:py-28"
      >
        <div className="container-page max-w-2xl">
          <div className="text-center mb-10">
            <p className="section-label mb-3">FAQ</p>
            <h2
              id="faq-heading"
              className="text-3xl font-bold text-ink tracking-tight"
            >
              Common questions
            </h2>
          </div>

          <dl className="space-y-4">
            {faqItems.map(({ q, a }) => (
              <div key={q} className="card p-5">
                <dt className="text-sm font-semibold text-ink flex items-start justify-between gap-2">
                  {q}
                  <ChevronDown size={16} className="text-ink-secondary flex-shrink-0 mt-0.5" aria-hidden="true" />
                </dt>
                <dd className="mt-2 text-sm text-ink-secondary leading-relaxed">
                  {a}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── 10. Final CTA ────────────────────────────────────────────────── */}
      <section
        id="final-cta"
        aria-labelledby="final-cta-heading"
        className="py-20 md:py-28 bg-forest"
      >
        <div className="container-page text-center">
          <h2
            id="final-cta-heading"
            className="text-3xl md:text-4xl font-bold text-white tracking-tight"
          >
            Start with a strategy and a draft.
          </h2>
          <p className="mt-4 text-forest-muted max-w-lg mx-auto">
            No payment card. No publishing in this preview. Just your strategy,
            voice, and drafts — organized in one place.
          </p>
          <div className="mt-8">
            <Link
              href="/login"
              id="final-cta-button"
              className="inline-flex items-center gap-2 bg-white text-forest px-6 py-3 rounded-lg text-base font-semibold hover:bg-offwhite transition-colors"
            >
              Try the draft-only preview
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
