import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  FileText,
  LockKeyhole,
  MessageCircle,
  Mic2,
  PauseCircle,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Nunuza — Your LinkedIn content workflow, under control",
  description:
    "Turn your positioning and ideas into consistent LinkedIn content. Nunuza carries your strategy and voice through drafting, review, scheduling, and publishing.",
  openGraph: {
    title: "Nunuza — Your LinkedIn content workflow, under control",
    description:
      "A strategy-led LinkedIn content workflow for solo founders. Draft in your voice, review every post, and publish on a consistent cadence.",
    type: "website",
  },
};

const workflow = [
  {
    number: "01",
    title: "Give your content direction",
    description:
      "Set your audience, positioning, goals, content pillars, and topics to avoid. Your strategy stays attached to the work.",
    icon: Workflow,
  },
  {
    number: "02",
    title: "Create in a voice people recognize",
    description:
      "Build a voice profile with tone, rhythm, phrases, and writing samples. Generate drafts from your strategy—not a blank prompt.",
    icon: Mic2,
  },
  {
    number: "03",
    title: "Review, approve, and publish",
    description:
      "Edit the draft, request a revision, approve it, then publish or schedule it. Your approval is the default gate.",
    icon: CheckCircle2,
  },
];

const capabilities = [
  {
    title: "Strategy that carries forward",
    description:
      "Audience, positioning, goals, content pillars, exclusions, and calls to action are saved and reused across planning and drafting.",
    icon: Workflow,
  },
  {
    title: "A voice profile—not a one-line prompt",
    description:
      "Shape tone, formality, sentence rhythm, phrases to use or avoid, and reference writing samples.",
    icon: Mic2,
  },
  {
    title: "A reviewable content history",
    description:
      "Edit drafts, preserve versions, see activity, and export your content in a portable format.",
    icon: FileText,
  },
  {
    title: "Telegram in your workflow",
    description:
      "Use supported Telegram controls and notifications to interact with your Nunuza workspace without relying on email alone.",
    icon: MessageCircle,
  },
  {
    title: "Remote MCP access",
    description:
      "Connect compatible AI clients through Nunuza's remote MCP integration for supported workspace reading and control actions.",
    icon: Sparkles,
  },
  {
    title: "Automation with boundaries",
    description:
      "Autopilot is optional. Defined posting limits, quiet hours, and a pause control keep automation bounded.",
    icon: ShieldCheck,
  },
];

const faqs = [
  {
    question: "What does Nunuza actually do?",
    answer:
      "Nunuza is a LinkedIn content operations workspace for solo founders. It keeps your strategy and voice preferences in context while you plan, draft, review, schedule, and publish posts.",
  },
  {
    question: "Will Nunuza publish without my approval?",
    answer:
      "The standard workflow requires your explicit approval before a post can be scheduled. Bounded Autopilot is a separate, optional mode that you must enable. It has defined posting limits, quiet hours, and a pause control.",
  },
  {
    question: "Does it connect to my personal LinkedIn profile?",
    answer:
      "Nunuza supports connecting a personal LinkedIn profile through LinkedIn's authorization flow and the permissions available to the app. Publishing capabilities depend on the access LinkedIn grants.",
  },
  {
    question: "What is included in the 14-day trial?",
    answer:
      "The trial includes the Nunuza Solo plan. A payment card is required at checkout. You are not charged during the 14-day trial; after that, the plan renews at $29/month unless you cancel before renewal.",
  },
  {
    question: "Can I cancel?",
    answer:
      "Yes. You can cancel from your billing page before the trial or billing period renews. Your access continues through the end of the applicable period.",
  },
  {
    question: "What happens to my content if I leave?",
    answer:
      "You can export your drafts and content versions in a portable format. Your content remains yours.",
  },
  {
    question: "What is not included in the current plan?",
    answer:
      "The current Solo plan is for one personal LinkedIn profile and one workspace. It does not include team seats, company-page publishing, or image, video, and carousel post creation.",
  },
];

function WorkflowPreview() {
  return (
    <div className="relative mx-auto w-full max-w-[570px]">
      <div
        aria-hidden="true"
        className="absolute -inset-5 rounded-[2rem] bg-forest-light/70 blur-2xl"
      />
      <div className="relative overflow-hidden rounded-2xl border border-border bg-white shadow-xl shadow-forest/10">
        <div className="flex items-center justify-between border-b border-border bg-offwhite px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#D9A69B]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#E4C98A]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#9DBFA7]" />
          </div>
          <span className="text-[10px] font-semibold tracking-[0.14em] text-ink-muted">
            THE NUNUZA WORKFLOW
          </span>
          <span className="w-10" />
        </div>

        <div className="space-y-4 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-ink-muted">CONTENT WORKSPACE</p>
              <p className="mt-1 text-lg font-semibold tracking-tight text-ink">
                Your next LinkedIn post
              </p>
            </div>
            <span className="rounded-full border border-forest-muted bg-forest-light px-3 py-1 text-xs font-medium text-forest">
              In review
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-offwhite p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-ink-secondary">
                <Workflow size={14} className="text-forest" />
                Strategy
              </div>
              <p className="mt-2 text-sm font-semibold text-ink">Founder lessons</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
                Audience · Early-stage founders
              </p>
            </div>
            <div className="rounded-xl border border-border bg-offwhite p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-ink-secondary">
                <Mic2 size={14} className="text-forest" />
                Voice profile
              </div>
              <p className="mt-2 text-sm font-semibold text-ink">Direct &amp; thoughtful</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
                Clear · Practical · Human
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                Draft preview
              </p>
              <span className="text-xs text-ink-muted">Example content</span>
            </div>
            <p className="mt-3 text-sm font-semibold leading-relaxed text-ink">
              Consistency is not about posting every day. It is about having something useful to say—and a system that helps you show up.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
              A good content process starts before the blank page. Know who you are speaking to, what you want them to remember, and what experience you can share.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
                <CheckCircle2 size={14} />
                Ready for your review
              </span>
              <span className="text-xs text-ink-muted">You stay in control</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-forest-light px-2 py-2.5">
              <p className="text-xs font-semibold text-forest">Strategy</p>
              <p className="mt-1 text-[10px] text-ink-secondary">Defined</p>
            </div>
            <div className="rounded-lg bg-forest-light px-2 py-2.5">
              <p className="text-xs font-semibold text-forest">Draft</p>
              <p className="mt-1 text-[10px] text-ink-secondary">Created</p>
            </div>
            <div className="rounded-lg border border-forest-muted bg-white px-2 py-2.5">
              <p className="text-xs font-semibold text-forest">Approval</p>
              <p className="mt-1 text-[10px] text-ink-secondary">Your decision</p>
            </div>
          </div>
        </div>
      </div>
      <p className="relative mt-3 text-center text-xs text-ink-muted">
        Illustrative workflow preview. Your workspace reflects your saved settings and content.
      </p>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <section
        id="hero"
        aria-labelledby="hero-heading"
        className="overflow-hidden border-b border-border bg-offwhite"
      >
        <div className="container-page grid items-center gap-14 py-16 md:py-24 lg:grid-cols-[0.95fr_1.05fr] lg:gap-10 lg:py-28">
          <div className="max-w-xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-forest-muted bg-white px-3 py-1.5 text-xs font-medium text-forest">
              <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
              LinkedIn content operations for solo founders
            </div>

            <h1
              id="hero-heading"
              className="text-4xl font-bold leading-[1.08] tracking-tight text-ink sm:text-5xl lg:text-[3.65rem]"
            >
              Your expertise deserves a{" "}
              <span className="text-forest">consistent presence.</span>
            </h1>

            <p className="mt-6 max-w-lg text-base leading-relaxed text-ink-secondary sm:text-lg">
              Nunuza turns your strategy and ideas into a repeatable LinkedIn content workflow—drafts in your voice, a clear review process, and publishing you control.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/login"
                id="hero-primary-cta"
                className="btn-primary justify-center px-6 py-3 text-base"
              >
                Start your 14-day trial
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <a
                href="#how-it-works"
                className="btn-secondary justify-center px-6 py-3 text-base"
              >
                See how it works
              </a>
            </div>

            <p className="mt-4 text-xs leading-relaxed text-ink-muted">
              Card required at signup · 14 days free · Then $29/month unless canceled
            </p>

            <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-ink-secondary">
              <span className="inline-flex items-center gap-1.5">
                <Check size={14} className="text-success" />
                Approval-first workflow
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check size={14} className="text-success" />
                Your voice stays yours
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check size={14} className="text-success" />
                Optional Autopilot
              </span>
            </div>
          </div>

          <WorkflowPreview />
        </div>
      </section>

      <section
        aria-label="Nunuza plan highlights"
        className="border-b border-border bg-white"
      >
        <div className="container-page grid grid-cols-2 gap-5 py-6 text-center sm:grid-cols-4">
          <div>
            <p className="text-xl font-bold tracking-tight text-ink">$29</p>
            <p className="mt-1 text-xs text-ink-secondary">Per month after trial</p>
          </div>
          <div>
            <p className="text-xl font-bold tracking-tight text-ink">30</p>
            <p className="mt-1 text-xs text-ink-secondary">New draft items / month</p>
          </div>
          <div>
            <p className="text-xl font-bold tracking-tight text-ink">1</p>
            <p className="mt-1 text-xs text-ink-secondary">Personal LinkedIn profile</p>
          </div>
          <div>
            <p className="text-xl font-bold tracking-tight text-ink">14 days</p>
            <p className="mt-1 text-xs text-ink-secondary">Free trial · card required</p>
          </div>
        </div>
      </section>

      <section
        id="how-it-works"
        aria-labelledby="workflow-heading"
        className="py-20 md:py-28"
      >
        <div className="container-page">
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <p className="section-label mb-3">A connected workflow</p>
            <h2
              id="workflow-heading"
              className="text-3xl font-bold tracking-tight text-ink sm:text-4xl"
            >
              From your point of view to a post worth publishing.
            </h2>
            <p className="mt-4 leading-relaxed text-ink-secondary">
              Not another blank prompt. A repeatable process built around what you know and how you communicate.
            </p>
          </div>

          <ol className="grid gap-5 md:grid-cols-3">
            {workflow.map(({ number, title, description, icon: Icon }) => (
              <li key={number} className="card p-6">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-[0.16em] text-ink-muted">
                    {number}
                  </span>
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-forest-light">
                    <Icon size={19} className="text-forest" aria-hidden="true" />
                  </span>
                </div>
                <h3 className="mt-6 text-lg font-semibold tracking-tight text-ink">
                  {title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
                  {description}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section
        id="features"
        aria-labelledby="features-heading"
        className="border-y border-border bg-offwhite py-20 md:py-28"
      >
        <div className="container-page">
          <div className="mb-12 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <p className="section-label mb-3">Built around your work</p>
              <h2
                id="features-heading"
                className="text-3xl font-bold tracking-tight text-ink sm:text-4xl"
              >
                More than generating posts.
              </h2>
            </div>
            <p className="max-w-md text-sm leading-relaxed text-ink-secondary">
              Strategy, voice, review, and operations stay connected—so every post does not start from zero.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {capabilities.map(({ title, description, icon: Icon }) => (
              <article key={title} className="card p-6">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-forest-light">
                  <Icon size={17} className="text-forest" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-base font-semibold text-ink">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
                  {description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="control"
        aria-labelledby="control-heading"
        className="py-20 md:py-28"
      >
        <div className="container-page grid items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="section-label mb-3">Automation with guardrails</p>
            <h2
              id="control-heading"
              className="text-3xl font-bold tracking-tight text-ink sm:text-4xl"
            >
              Automation should work for you—not take over.
            </h2>
            <p className="mt-4 max-w-xl leading-relaxed text-ink-secondary">
              Keep the approval-first workflow, or deliberately enable Bounded Autopilot when you are ready. The controls are part of the product, not an afterthought.
            </p>
            <ul className="mt-7 space-y-4">
              {[
                ["Approval by default", "Drafts wait for your explicit review before scheduling."],
                ["Defined publishing limits", "Autopilot is capped at one post per calendar day and seven per rolling seven-day period."],
                ["Quiet hours and pause control", "Set when automation should stay quiet and stop it when you need to."],
              ].map(([title, description]) => (
                <li key={title} className="flex gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-forest-light">
                    <Check size={15} className="text-forest" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-ink">{title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-ink-secondary">
                      {description}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-border bg-offwhite p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white">
                <LockKeyhole size={19} className="text-forest" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">You choose the level of automation</p>
                <p className="text-xs text-ink-secondary">A deliberate control—not a hidden default</p>
              </div>
            </div>
            <div className="mt-6 space-y-3">
              <div className="rounded-xl border border-forest-muted bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-ink">Approval-first</span>
                  <span className="rounded-full bg-forest-light px-2.5 py-1 text-[11px] font-semibold text-forest">
                    Default
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
                  You review and approve each post before it can be scheduled.
                </p>
              </div>
              <div className="rounded-xl border border-border bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-ink">Bounded Autopilot</span>
                  <span className="rounded-full bg-offwhite px-2.5 py-1 text-[11px] font-semibold text-ink-secondary">
                    Optional
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
                  Enable automation within the plan's hard publishing limits, quiet hours, and pause controls.
                </p>
                <div className="mt-4 flex items-center gap-2 border-t border-border pt-3 text-xs text-ink-muted">
                  <PauseCircle size={14} />
                  Pause when you want to take control
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="pricing"
        aria-labelledby="pricing-heading"
        className="border-y border-border bg-offwhite py-20 md:py-28"
      >
        <div className="container-page max-w-5xl">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <p className="section-label mb-3">Straightforward pricing</p>
            <h2
              id="pricing-heading"
              className="text-3xl font-bold tracking-tight text-ink sm:text-4xl"
            >
              One plan. Your complete content workflow.
            </h2>
            <p className="mt-4 text-ink-secondary">
              Start with 14 days to put your strategy and publishing process in place.
            </p>
          </div>

          <div className="mx-auto grid max-w-4xl overflow-hidden rounded-2xl border border-border bg-white shadow-sm md:grid-cols-[1fr_0.9fr]">
            <div className="p-7 sm:p-9">
              <p className="text-sm font-semibold text-forest">Nunuza Solo</p>
              <div className="mt-4 flex items-end gap-2">
                <span className="text-5xl font-bold tracking-tight text-ink">$29</span>
                <span className="pb-1.5 text-sm text-ink-secondary">/ month</span>
              </div>
              <p className="mt-2 text-sm text-ink-secondary">
                After your 14-day free trial. Payment card required at signup.
              </p>
              <ul className="mt-7 space-y-3">
                {[
                  "One personal LinkedIn profile",
                  "One active content strategy and voice profile",
                  "Up to 30 new draft items per billing month",
                  "Dashboard, Telegram, and remote MCP controls",
                  "Bounded Autopilot with strict safety limits",
                  "Version history, activity log, and content export",
                ].map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm text-ink">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                href="/login"
                id="pricing-cta"
                className="btn-primary mt-8 w-full justify-center py-3 text-base"
              >
                Start your 14-day trial
                <ArrowRight size={17} />
              </Link>
              <p className="mt-3 text-center text-xs leading-relaxed text-ink-muted">
                Then $29/month unless canceled before renewal.
              </p>
            </div>

            <div className="border-t border-border bg-forest p-7 text-white sm:p-9 md:border-l md:border-t-0">
              <p className="text-sm font-semibold text-white/80">Trial, clearly explained</p>
              <div className="mt-6 space-y-5">
                <div className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-xs font-semibold">1</span>
                  <div>
                    <p className="text-sm font-semibold">Today</p>
                    <p className="mt-1 text-sm leading-relaxed text-white/75">
                      Start the 14-day trial. A payment card is required at checkout.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-xs font-semibold">2</span>
                  <div>
                    <p className="text-sm font-semibold">During the trial</p>
                    <p className="mt-1 text-sm leading-relaxed text-white/75">
                      Set up your workspace, strategy, voice profile, and content workflow.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/15 text-xs font-semibold">3</span>
                  <div>
                    <p className="text-sm font-semibold">After 14 days</p>
                    <p className="mt-1 text-sm leading-relaxed text-white/75">
                      Your subscription renews at $29/month unless you cancel before the trial ends.
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-8 border-t border-white/20 pt-5 text-xs leading-relaxed text-white/70">
                No permanent free plan. No team seats or company-page publishing in the current Solo plan.
              </div>
              <Link
                href="/pricing"
                className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-white underline decoration-white/40 underline-offset-4 hover:decoration-white"
              >
                Full pricing and plan details
                <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section
        id="faq"
        aria-labelledby="faq-heading"
        className="py-20 md:py-28"
      >
        <div className="container-page max-w-3xl">
          <div className="mb-10 text-center">
            <p className="section-label mb-3">Questions, answered</p>
            <h2
              id="faq-heading"
              className="text-3xl font-bold tracking-tight text-ink sm:text-4xl"
            >
              Before you get started.
            </h2>
          </div>
          <div className="space-y-3">
            {faqs.map(({ question, answer }) => (
              <details key={question} className="group rounded-xl border border-border bg-white p-5 open:border-forest-muted">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-sm font-semibold text-ink marker:content-none [&::-webkit-details-marker]:hidden">
                  {question}
                  <span className="text-lg font-normal text-ink-muted transition-transform group-open:rotate-45" aria-hidden="true">
                    +
                  </span>
                </summary>
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-secondary">
                  {answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section
        id="final-cta"
        aria-labelledby="final-cta-heading"
        className="bg-forest py-20 md:py-24"
      >
        <div className="container-page text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/65">
            Build a content habit that lasts
          </p>
          <h2
            id="final-cta-heading"
            className="mx-auto mt-4 max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl"
          >
            Make your next good idea count.
          </h2>
          <p className="mx-auto mt-4 max-w-xl leading-relaxed text-white/75">
            Bring your strategy and point of view. Nunuza helps turn them into a consistent LinkedIn workflow—with you in control.
          </p>
          <Link
            href="/login"
            id="final-cta-button"
            className="mt-8 inline-flex items-center justify-center gap-2 rounded-lg bg-white px-7 py-3 text-base font-semibold text-forest transition-colors hover:bg-offwhite"
          >
            Start your 14-day trial
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <p className="mt-4 text-xs text-white/65">
            Card required · 14 days free · Then $29/month unless canceled
          </p>
        </div>
      </section>
    </>
  );
}
