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
  ChevronDown,
  Sparkles,
  BarChart2,
  Clock,
  Linkedin,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Nunuza — Autonomous LinkedIn content operations for founders",
  description:
    "Your LinkedIn strategy, voice, drafts, and automated publishing in one workflow. Start with a 14-day free trial ($29/mo) or private beta access.",
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
    title: "Export or schedule publication",
    description:
      "Copy to clipboard, export drafts in a portable format, or schedule automated LinkedIn publishing with hard safety caps enforced server-side.",
  },
];

const featureCards = [
  {
    icon: BarChart2,
    title: "Persistent strategy",
    description:
      "Your audience, goals, content pillars, and voice preferences are stored and applied to every generation — not re-entered every session.",
  },
  {
    icon: Mic2,
    title: "Structured voice profile",
    description:
      "Set tone, sentence length, formality, phrases to use or avoid, and optional writing samples. The agent follows your defined style, not a generic AI voice.",
  },
  {
    icon: ClipboardCheck,
    title: "Approval-required workflow",
    description:
      "Every draft requires your explicit review and approval. Nothing publishes automatically until you say so. You are the final decision-maker.",
  },
  {
    icon: FileText,
    title: "Version history",
    description:
      "Every edit and revision is preserved. You can see how a draft evolved and what changed at each step.",
  },
  {
    icon: Download,
    title: "Export in portable format",
    description:
      "Your drafts and content versions can be exported regardless of trial or subscription status, including after cancellation.",
  },
  {
    icon: Clock,
    title: "Bounded Autopilot",
    description:
      "Up to 1 post per day, 7 posts per rolling week. Hard rate caps enforced server-side protect your LinkedIn profile reputation.",
  },
];

const faqItems = [
  {
    q: "How does the commercial trial work?",
    a: "Commercial customers receive a 14-day free trial with full feature access across AI drafting, LinkedIn publishing, durable scheduling, and Bounded Autopilot. A payment card is collected at checkout, and the subscription automatically renews at $29/month after 14 days unless canceled.",
  },
  {
    q: "Can I publish to my personal LinkedIn profile?",
    a: "Yes. Both commercial customers (during trial and active subscription) and authorized private beta testers can connect their personal LinkedIn profile via official OAuth and publish human-approved posts or utilize bounded scheduling.",
  },
  {
    q: "What is the Private Beta?",
    a: "Private Beta access is reserved for authorized design partners, internal testing, and product validation. Beta workspaces are provisioned directly by an administrator and receive full v1.0.0 capabilities without requiring a credit card or subscription.",
  },
  {
    q: "Is there a permanent free customer plan?",
    a: "No. Nunuza is a professional SaaS product offering a 14-day trial followed by $29/month. There is no permanent free customer tier.",
  },
  {
    q: "What happens to my drafts if I cancel?",
    a: "Your drafts and content versions can be exported in portable JSON format at any time, including after cancellation or trial expiration. Your content is yours.",
  },
  {
    q: "How does Autopilot work safely?",
    a: "Autopilot requires explicit user opt-in and is constrained by strict safety bounds: maximum 1 post per calendar day, maximum 7 posts per rolling 7-day period, quiet hours, and an instant pause/emergency stop control.",
  },
];

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section
        id="hero"
        aria-labelledby="hero-headline"
        className="bg-offwhite border-b border-border"
      >
        <div className="container-page py-20 md:py-32 text-center">
          {/* Stage label */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-border text-ink-secondary text-xs font-medium mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" aria-hidden="true" />
            Now in private beta · 14-day free trial for commercial access
          </div>

          <h1
            id="hero-headline"
            className="text-4xl md:text-5xl lg:text-6xl font-bold text-ink leading-[1.1] tracking-tight max-w-4xl mx-auto"
          >
            LinkedIn content operations,{" "}
            <span className="text-forest">built for founders.</span>
          </h1>

          <p className="mt-6 text-lg text-ink-secondary max-w-2xl mx-auto leading-relaxed">
            Define your strategy once. Generate, review, and publish LinkedIn posts on a consistent cadence — without losing your voice or your time.
          </p>

          {/* CTAs */}
          <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/login"
              id="hero-primary-cta"
              className="btn-primary text-base px-7 py-3"
            >
              Start 14-Day Free Trial
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <a
              href="#how-it-works"
              id="hero-secondary-cta"
              className="btn-secondary text-base px-7 py-3"
            >
              See how it works
            </a>
          </div>

          <p className="mt-5 text-sm text-ink-muted">
            14 days free · \$29/month after · Cancel anytime
          </p>

          {/* Trust signals */}
          <div className="mt-14 flex flex-wrap items-center justify-center gap-6 text-sm text-ink-secondary">
            {[
              "Approval-required by default",
              "Max 1 post/day hard cap",
              "Full data export",
              "Cancel anytime",
            ].map((item) => (
              <span key={item} className="flex items-center gap-1.5">
                <CheckCircle2 size={14} className="text-success shrink-0" aria-hidden="true" />
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Workflow steps ──────────────────────────────────────────── */}
      <section
        id="how-it-works"
        aria-labelledby="workflow-heading"
        className="py-20 md:py-28"
      >
        <div className="container-page">
          <div className="text-center mb-14">
            <p className="section-label mb-3">Complete operations workflow</p>
            <h2
              id="workflow-heading"
              className="text-3xl md:text-4xl font-bold text-ink tracking-tight"
            >
              From strategy to published post.
            </h2>
            <p className="mt-4 text-ink-secondary max-w-xl mx-auto">
              A connected workflow that keeps your voice, strategy, and publishing schedule in sync — without manual coordination.
            </p>
          </div>

          <ol className="grid md:grid-cols-2 gap-5 list-none">
            {workflowSteps.map(({ icon: Icon, step, title, description }) => (
              <li key={step} className="card p-6 flex gap-4">
                <div
                  className="flex-shrink-0 w-9 h-9 rounded-lg bg-forest-light flex items-center justify-center"
                  aria-hidden="true"
                >
                  <Icon size={18} className="text-forest" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-ink-muted mb-1 uppercase tracking-wider">
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

      {/* ── Features ──────────────────────────────────────────────── */}
      <section
        id="features"
        aria-labelledby="features-heading"
        className="py-20 md:py-28 bg-offwhite border-y border-border"
      >
        <div className="container-page">
          <div className="text-center mb-14">
            <p className="section-label mb-3">What&apos;s included</p>
            <h2
              id="features-heading"
              className="text-3xl md:text-4xl font-bold text-ink tracking-tight"
            >
              Everything a founder needs to publish consistently.
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {featureCards.map(({ icon: Icon, title, description }) => (
              <article key={title} className="card p-5">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-forest-light flex items-center justify-center shrink-0">
                    <Icon size={16} className="text-forest" aria-hidden="true" />
                  </div>
                  <h3 className="text-sm font-semibold text-ink">{title}</h3>
                </div>
                <p className="text-sm text-ink-secondary leading-relaxed">
                  {description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Access pathways ──────────────────────────────────────────── */}
      <section
        id="permissions"
        aria-labelledby="permissions-heading"
        className="py-20 md:py-28"
      >
        <div className="container-page max-w-3xl">
          <div className="text-center mb-10">
            <p className="section-label mb-3">Access &amp; Permissions</p>
            <h2
              id="permissions-heading"
              className="text-3xl font-bold text-ink tracking-tight"
            >
              Two ways to access. You stay in control.
            </h2>
            <p className="mt-4 text-ink-secondary">
              Nunuza provides full v1.0.0 feature access through commercial trials or private partner beta.
            </p>
          </div>

          <div className="space-y-3">
            <div className="card p-5 flex gap-4">
              <div className="w-9 h-9 rounded-lg bg-forest-light flex items-center justify-center shrink-0 mt-0.5">
                <Linkedin size={18} className="text-forest" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-semibold text-ink mb-1">
                  Commercial Access — 14-Day Free Trial
                </p>
                <p className="text-sm text-ink-secondary">
                  Start with a 14-day free trial (credit card required). Full v1.0.0 access across AI drafting, LinkedIn personal-profile publishing, scheduling, and Autopilot. Renews at \$29/month unless canceled.
                </p>
              </div>
            </div>

            <div className="card p-5 flex gap-4">
              <div className="w-9 h-9 rounded-lg bg-forest-light flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles size={18} className="text-forest" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-semibold text-ink mb-1">
                  Private Beta Access
                </p>
                <p className="text-sm text-ink-secondary">
                  Authorized design partners and internal testers receive complete v1.0.0 capabilities directly from an administrator, with no subscription or payment card required.
                </p>
              </div>
            </div>

            <div className="card p-5 flex gap-4">
              <div className="w-9 h-9 rounded-lg bg-forest-light flex items-center justify-center shrink-0 mt-0.5">
                <Lock size={18} className="text-forest" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-semibold text-ink mb-1">
                  Bounded Safety &amp; Control
                </p>
                <p className="text-sm text-ink-secondary">
                  Every post requires your explicit confirmation by default. When you choose to enable Autopilot, hard rate caps (1 post/day, 7 posts/week) and quiet hours ensure your profile remains safe and authentic.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────────────── */}
      <section
        id="pricing"
        aria-labelledby="pricing-heading"
        className="py-20 md:py-28 bg-offwhite border-y border-border"
      >
        <div className="container-page max-w-lg text-center">
          <p className="section-label mb-3">Pricing</p>
          <h2
            id="pricing-heading"
            className="text-3xl md:text-4xl font-bold text-ink tracking-tight"
          >
            One plan. Everything included.
          </h2>
          <p className="mt-4 text-ink-secondary">
            Full autonomous LinkedIn content operations for solo founders.
          </p>

          <div className="mt-10 card p-8 text-left">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <h3 className="text-lg font-bold text-ink">Nunuza Solo</h3>
                <p className="text-sm text-ink-secondary mt-1">14-day free trial included.</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-3xl font-bold text-ink leading-none">\$29</p>
                <p className="text-xs text-ink-muted mt-1">/ month</p>
              </div>
            </div>

            <ul className="space-y-2.5 mb-6" role="list">
              {[
                "One personal LinkedIn profile",
                "One active content strategy",
                "Up to 30 new draft items per billing month",
                "Dashboard + Telegram + remote MCP controls",
                "Bounded Autopilot (with strict safety caps)",
                "Full version history and draft export",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-ink">
                  <CheckCircle2 size={15} className="text-success shrink-0 mt-0.5" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>

            <Link href="/login" className="btn-primary w-full py-3 text-sm font-semibold justify-center">
              Start 14-Day Free Trial
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>

          <p className="mt-5 text-xs text-ink-muted">
            14-day card-required trial. Then \$29/month unless canceled. Cancel anytime in your dashboard.
          </p>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────── */}
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

          <dl className="space-y-3">
            {faqItems.map(({ q, a }) => (
              <div key={q} className="card p-5">
                <dt className="text-sm font-semibold text-ink flex items-start justify-between gap-3">
                  <span>{q}</span>
                  <ChevronDown size={16} className="text-ink-muted shrink-0 mt-0.5" aria-hidden="true" />
                </dt>
                <dd className="mt-2.5 text-sm text-ink-secondary leading-relaxed">
                  {a}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────── */}
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
            Start publishing on LinkedIn consistently.
          </h2>
          <p className="mt-4 text-forest-muted max-w-lg mx-auto">
            Your strategy, your voice, your cadence. Full v1.0.0 access on a 14-day free trial — no commitment until after.
          </p>
          <div className="mt-8">
            <Link
              href="/login"
              id="final-cta-button"
              className="inline-flex items-center gap-2 bg-white text-forest px-7 py-3 rounded-lg text-base font-semibold hover:bg-offwhite transition-colors"
            >
              Start 14-Day Free Trial
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
          <p className="mt-5 text-sm text-forest-muted">
            14 days free · \$29/month after · Cancel anytime
          </p>
        </div>
      </section>
    </>
  );
}
