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
  Sparkles,
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
      {/* ── 1 & 2. Hero ──────────────────────────────────────────────────── */}
      <section
        id="hero"
        aria-labelledby="hero-headline"
        className="bg-offwhite border-b border-border"
      >
        <div className="container-page py-20 md:py-28 text-center">
          {/* Stage label */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-forest-light border border-forest-muted text-forest text-xs font-semibold mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-forest inline-block" aria-hidden="true" />
            14-Day Free Trial · Card Required · Private Beta
          </div>

          <h1
            id="hero-headline"
            className="text-4xl md:text-5xl font-bold text-ink leading-tight tracking-tight max-w-3xl mx-auto"
          >
            Your LinkedIn strategy, voice, drafts, and publishing in one workflow.
          </h1>

          <p className="mt-6 text-lg text-ink-secondary max-w-2xl mx-auto leading-relaxed">
            Plan, generate, schedule, and publish high-impact LinkedIn content. Full v1.0.0 capabilities available through our 14-day commercial trial or private partner beta.
          </p>

          {/* CTAs */}
          <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/login"
              id="hero-primary-cta"
              className="btn-primary text-base px-6 py-3"
            >
              Start 14-Day Free Trial
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

          <p className="mt-6 text-xs text-ink-secondary">
            14 days free · $29/month after · Cancel anytime
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
            <p className="section-label mb-3">Complete operations workflow</p>
            <h2
              id="workflow-heading"
              className="text-3xl md:text-4xl font-bold text-ink tracking-tight"
            >
              From strategy to LinkedIn publication.
            </h2>
            <p className="mt-4 text-ink-secondary max-w-xl mx-auto">
              A seamless workflow that keeps your voice, strategy, and publication schedule
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
            <p className="section-label mb-3">Complete v1.0.0 Features</p>
            <h2
              id="features-heading"
              className="text-3xl md:text-4xl font-bold text-ink tracking-tight"
            >
              Autonomous content operations, built for founders.
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
            <p className="section-label mb-3">Access &amp; Permissions</p>
            <h2
              id="permissions-heading"
              className="text-3xl font-bold text-ink tracking-tight"
            >
              Two access pathways. You are always in control.
            </h2>
            <p className="mt-4 text-ink-secondary">
              Nunuza provides full v1.0.0 feature access through commercial trials or private partner beta.
            </p>
          </div>

          <div className="space-y-4">
            <div className="card p-5 flex gap-4">
              <CheckCircle2
                size={18}
                className="text-forest flex-shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-semibold text-ink mb-1">
                  Commercial Access (14-Day Free Trial)
                </p>
                <p className="text-sm text-ink-secondary">
                  Start with a 14-day free trial (credit card required). Full v1.0.0 access across AI drafting, LinkedIn personal-profile publishing, scheduling, and Autopilot. Renews at $29/month unless canceled.
                </p>
              </div>
            </div>

            <div className="card p-5 flex gap-4">
              <Sparkles
                size={18}
                className="text-forest flex-shrink-0 mt-0.5"
                aria-hidden="true"
              />
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
              <Lock
                size={18}
                className="text-forest flex-shrink-0 mt-0.5"
                aria-hidden="true"
              />
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
            One simple plan. 14-day trial.
          </h2>
          <p className="mt-4 text-ink-secondary">
            Full autonomous LinkedIn content operations agent for solo founders.
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
                "Bounded Autopilot (with strict safety caps)",
                "Full version history and draft export",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2.5 text-sm text-ink">
                  <CheckCircle2 size={15} className="text-success flex-shrink-0" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>

            <div className="pt-2 text-center">
              <Link href="/login" className="btn-primary w-full py-3 inline-block text-center font-semibold text-sm">
                Start 14-Day Free Trial
              </Link>
            </div>
          </div>

          <p className="mt-6 text-xs text-ink-secondary">
            14-day card-required trial. Then $29/month unless canceled. Cancel anytime in your dashboard.
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
            Launch your LinkedIn content operations.
          </h2>
          <p className="mt-4 text-forest-muted max-w-lg mx-auto">
            Experience autonomous content operations tailored to your voice and strategy. Start your 14-day free trial today.
          </p>
          <div className="mt-8">
            <Link
              href="/login"
              id="final-cta-button"
              className="inline-flex items-center gap-2 bg-white text-forest px-6 py-3 rounded-lg text-base font-semibold hover:bg-offwhite transition-colors"
            >
              Start 14-Day Free Trial
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
