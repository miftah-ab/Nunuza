import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Command,
  MessageCircle,
  Mic2,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Nunuza — Your LinkedIn content agent",
  description:
    "A connected LinkedIn content agent for founders. Keep your strategy, voice, ideas, and review workflow in one place, with control over every next step.",
  openGraph: {
    title: "Nunuza — Your LinkedIn content agent",
    description:
      "Your ideas, your voice, and a more deliberate LinkedIn workflow. Work with Nunuza from your workspace, Telegram, or compatible AI clients.",
    type: "website",
  },
};

function AgentThreadPreview() {
  return (
    <div className="relative mx-auto w-full max-w-[620px]">
      <div aria-hidden="true" className="absolute -inset-8 rounded-[3rem] bg-forest-light/80 blur-3xl" />
      <div className="relative overflow-hidden rounded-[1.65rem] border border-[#DDE5DF] bg-white shadow-[0_32px_100px_-38px_rgba(23,76,60,0.34)]">
        <div className="flex items-center justify-between border-b border-border bg-[#FBFCFA] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-forest text-white">
              <Sparkles size={17} />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">Nunuza</p>
              <p className="text-[11px] text-ink-muted">Your content agent</p>
            </div>
          </div>
          <span className="rounded-full border border-forest-muted bg-forest-light px-3 py-1 text-[10px] font-semibold text-forest">Example conversation</span>
        </div>

        <div className="space-y-5 bg-[#FCFDFB] p-5 sm:p-7">
          <div className="ml-auto max-w-[82%] rounded-2xl rounded-br-md bg-forest px-4 py-3 text-sm leading-relaxed text-white shadow-sm">
            I want to write about what I learned from nearly abandoning my product. Make it honest, not motivational.
            <p className="mt-2 text-right text-[10px] text-white/60">You · 9:41 AM</p>
          </div>

          <div className="flex max-w-[91%] gap-3">
            <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-forest-light text-forest">
              <Sparkles size={15} />
            </div>
            <div className="min-w-0 rounded-2xl rounded-tl-md border border-border bg-white px-4 py-3 shadow-[0_4px_18px_-14px_rgba(20,40,30,0.25)]">
              <p className="text-sm leading-relaxed text-ink">I’ll shape this around your founder perspective and the direct tone in your voice profile. One useful angle: the moment you realized the problem wasn’t the code.</p>
              <p className="mt-2 text-[10px] text-ink-muted">Nunuza · Thinking with your context</p>
            </div>
          </div>

          <div className="ml-11 overflow-hidden rounded-2xl border border-forest-muted bg-white shadow-[0_12px_30px_-24px_rgba(23,76,60,0.35)]">
            <div className="flex items-center justify-between border-b border-border bg-[#F7FAF7] px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-forest-light text-forest"><Command size={13} /></div>
                <span className="text-xs font-semibold text-ink">Draft · Founder lesson</span>
              </div>
              <span className="rounded-full bg-[#FDF3E3] px-2.5 py-1 text-[9px] font-semibold text-[#94601E]">For your review</span>
            </div>
            <div className="p-4 sm:p-5">
              <p className="text-sm font-semibold leading-relaxed text-ink sm:text-base">I nearly walked away from the product I had spent months building.</p>
              <p className="mt-3 text-xs leading-[1.8] text-ink-secondary sm:text-sm">Not because the code was impossible. I had slowly stopped listening to the people I was building it for. I was polishing what was easy to measure instead of fixing what was painful to use.</p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-forest"><CheckCircle2 size={13} /> Strategy and voice context applied</span>
                <span className="text-[10px] text-ink-muted">Illustrative draft</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 pl-11 text-[11px] text-ink-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-forest" />
            Nothing is published from this example. You stay in control.
          </div>
        </div>
      </div>
      <p className="relative mt-3 text-center text-[11px] text-ink-muted">Illustrative product conversation. It does not represent live account activity.</p>
    </div>
  );
}

function WeeklyPlanPreview() {
  const days = [
    { day: "MON", date: "12", title: "A lesson from building", type: "Founder story", status: "Draft" },
    { day: "TUE", date: "13", title: "What customers taught me", type: "Customer insight", status: "Idea" },
    { day: "WED", date: "14", title: "The decision I got wrong", type: "Point of view", status: "Draft" },
    { day: "THU", date: "15", title: "A practical product lesson", type: "How I work", status: "Idea" },
  ];

  return (
    <div className="overflow-hidden rounded-[1.5rem] border border-border bg-white shadow-[0_24px_70px_-42px_rgba(23,76,60,0.28)]">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div><p className="text-sm font-semibold text-ink">Your content plan</p><p className="mt-1 text-[11px] text-ink-muted">A sample week · Illustrative</p></div>
        <span className="rounded-lg bg-forest-light px-3 py-1.5 text-[10px] font-semibold text-forest">4 ideas</span>
      </div>
      <div className="divide-y divide-border">
        {days.map((item, index) => (
          <div key={item.day} className="flex items-center gap-4 px-5 py-4">
            <div className="w-11 shrink-0 text-center">
              <p className="text-[9px] font-semibold tracking-wider text-ink-muted">{item.day}</p>
              <p className="mt-0.5 text-lg font-semibold tracking-tight text-ink">{item.date}</p>
            </div>
            <div className="h-10 w-px bg-border" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-ink sm:text-sm">{item.title}</p>
              <p className="mt-1 text-[10px] text-ink-muted">{item.type}</p>
            </div>
            <span className={"shrink-0 rounded-full px-2.5 py-1 text-[9px] font-semibold " + (index % 2 === 0 ? "bg-forest-light text-forest" : "bg-[#F4F2EC] text-[#777263]")}>{item.status}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-border bg-[#FBFCFA] px-5 py-3 text-[10px] text-ink-secondary">
        <Check size={13} className="text-forest" /> You choose what moves from idea to draft.
      </div>
    </div>
  );
}

const faqs = [
  {
    question: "Is Nunuza just another AI post generator?",
    answer:
      "No. Nunuza is designed around persistent context: your audience, positioning, content pillars, voice, ideas, and drafts stay connected instead of being re-entered for every prompt.",
  },
  {
    question: "Can I work with Nunuza from Telegram?",
    answer:
      "Yes. Telegram is a connected control surface for supported Nunuza actions. What you can do depends on the tools and permissions enabled for your workspace.",
  },
  {
    question: "Does Nunuza publish to LinkedIn automatically?",
    answer:
      "LinkedIn actions depend on the permissions LinkedIn has granted to the Nunuza app and the capabilities available to your account. The product should never imply that an unavailable permission is active. You remain in control of the workflow.",
  },
  {
    question: "Will the writing sound like me?",
    answer:
      "Nunuza uses the voice guidance and writing examples you provide to shape drafts. You can review and revise the result before taking the next step.",
  },
  {
    question: "How much does Nunuza cost?",
    answer:
      "Nunuza Solo has a 14-day trial and then costs $29 per month unless canceled before renewal. A payment card is required to start the trial. See the pricing page for the full terms.",
  },
];

export default function HomePage() {
  return (
    <>
      <section id="hero" aria-labelledby="hero-heading" className="relative isolate overflow-hidden border-b border-border bg-offwhite">
        <div aria-hidden="true" className="pointer-events-none absolute -right-44 -top-48 h-[680px] w-[680px] rounded-full border border-forest-muted/50" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-[470px] w-[470px] rounded-full border border-forest-muted/40" />
        <div className="container-page relative grid items-center gap-14 py-16 md:py-20 lg:grid-cols-[0.88fr_1.12fr] lg:gap-10 lg:py-24">
          <div className="max-w-xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-forest-muted bg-white/80 px-3 py-1.5 text-[10px] font-semibold tracking-[0.14em] text-forest">
              <span className="h-1.5 w-1.5 rounded-full bg-success" /> YOUR LINKEDIN CONTENT AGENT
            </div>
            <h1 id="hero-heading" className="text-[2.8rem] font-semibold leading-[1.02] tracking-[-0.06em] text-ink sm:text-5xl lg:text-[3.95rem]">
              Your ideas deserve <span className="text-forest">more than another prompt.</span>
            </h1>
            <p className="mt-6 max-w-lg text-base leading-[1.8] text-ink-secondary sm:text-lg">
              Nunuza keeps your strategy, voice, and content work connected—then helps you move from a rough thought to a considered LinkedIn draft.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/login" id="hero-primary-cta" className="btn-primary justify-center px-6 py-3.5 text-sm">Meet your agent <ArrowRight size={17} /></Link>
              <a href="#how-it-works" className="btn-secondary justify-center px-6 py-3.5 text-sm">See how it works <ArrowDownRight size={16} /></a>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-5 text-[11px] font-medium text-ink-secondary">
              <span className="inline-flex items-center gap-1.5"><Check size={13} className="text-forest" /> Your strategy stays connected</span>
              <span className="inline-flex items-center gap-1.5"><Check size={13} className="text-forest" /> Your voice stays yours</span>
              <span className="inline-flex items-center gap-1.5"><Check size={13} className="text-forest" /> You stay in control</span>
            </div>
          </div>
          <AgentThreadPreview />
        </div>
      </section>

      <section id="how-it-works" aria-labelledby="loop-heading" className="py-20 md:py-28">
        <div className="container-page">
          <div className="grid items-end gap-6 md:grid-cols-[1fr_0.72fr]">
            <div className="max-w-2xl">
              <p className="section-label mb-3">One connected loop</p>
              <h2 id="loop-heading" className="text-3xl font-semibold leading-[1.1] tracking-[-0.045em] text-ink sm:text-4xl">From a passing thought to <span className="text-forest">work you can use.</span></h2>
            </div>
            <p className="max-w-md text-sm leading-[1.8] text-ink-secondary">You bring the experience and point of view. Nunuza helps organize the context, shape the writing, and keep the next step clear.</p>
          </div>

          <div className="mt-14 grid gap-8 md:grid-cols-4 md:gap-5">
            {[
              { number: "01", title: "Give it direction", text: "Set your audience, positioning, goals, and the themes you want to be known for.", icon: Workflow },
              { number: "02", title: "Teach it your voice", text: "Add writing samples and guidance for tone, rhythm, phrases, and what to avoid.", icon: Mic2 },
              { number: "03", title: "Think and create together", text: "Bring ideas in naturally. Turn the useful ones into drafts with your context attached.", icon: MessageCircle },
              { number: "04", title: "Decide what happens next", text: "Review, refine, and manage each item from your workspace or supported connected controls.", icon: ShieldCheck },
            ].map(({ number, title, text, icon: Icon }, index) => (
              <article key={number} className="relative border-t border-forest-muted pt-5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold tracking-[0.16em] text-ink-muted">{number}</span>
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-forest-light text-forest"><Icon size={18} /></span>
                </div>
                <h3 className="mt-6 text-base font-semibold tracking-tight text-ink">{title}</h3>
                <p className="mt-3 text-sm leading-[1.8] text-ink-secondary">{text}</p>
                {index < 3 && <span aria-hidden="true" className="absolute -bottom-5 right-0 hidden text-forest-muted md:block"><ArrowRight size={16} /></span>}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="week-heading" className="overflow-hidden border-y border-border bg-offwhite py-20 md:py-28">
        <div className="container-page grid items-center gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
          <div>
            <p className="section-label mb-3">A little less blank-page anxiety</p>
            <h2 id="week-heading" className="text-3xl font-semibold leading-[1.1] tracking-[-0.045em] text-ink sm:text-4xl">Your next week shouldn’t start <span className="text-forest">from zero.</span></h2>
            <p className="mt-5 max-w-lg text-sm leading-[1.85] text-ink-secondary">Keep a living bank of ideas and shape them into a plan that reflects what you want to say. Your calendar becomes a working view of your thinking—not another place to manage.</p>
            <Link href="/login" className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-forest hover:gap-3">Explore your workspace <ArrowRight size={16} /></Link>
          </div>
          <WeeklyPlanPreview />
        </div>
      </section>

      <section aria-labelledby="context-heading" className="py-20 md:py-28">
        <div className="container-page">
          <div className="mx-auto max-w-2xl text-center">
            <p className="section-label mb-3">Context makes the difference</p>
            <h2 id="context-heading" className="text-3xl font-semibold leading-[1.1] tracking-[-0.045em] text-ink sm:text-4xl">It should know what matters to <span className="text-forest">your work.</span></h2>
            <p className="mt-4 text-sm leading-[1.8] text-ink-secondary">A useful agent needs more than a clever prompt. It needs the context you have already taken time to build.</p>
          </div>
          <div className="mt-12 grid gap-0 overflow-hidden rounded-[1.5rem] border border-border bg-white md:grid-cols-3">
            <article className="p-7 sm:p-9">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-forest-light text-forest"><Workflow size={20} /></span>
              <h3 className="mt-6 text-lg font-semibold tracking-tight text-ink">Your strategy</h3>
              <p className="mt-3 text-sm leading-[1.8] text-ink-secondary">Audience, positioning, content pillars, goals, exclusions, and the ideas you want to keep returning to.</p>
            </article>
            <article className="border-t border-border p-7 sm:p-9 md:border-l md:border-t-0">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-forest-light text-forest"><Mic2 size={20} /></span>
              <h3 className="mt-6 text-lg font-semibold tracking-tight text-ink">Your voice</h3>
              <p className="mt-3 text-sm leading-[1.8] text-ink-secondary">Tone, sentence rhythm, preferred language, phrases to avoid, and examples of how you actually write.</p>
            </article>
            <article className="border-t border-border p-7 sm:p-9 md:border-l md:border-t-0">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-forest-light text-forest"><Command size={20} /></span>
              <h3 className="mt-6 text-lg font-semibold tracking-tight text-ink">Your operations</h3>
              <p className="mt-3 text-sm leading-[1.8] text-ink-secondary">Ideas, drafts, revisions, and activity stay organized so you can see what exists and what needs attention.</p>
            </article>
          </div>
        </div>
      </section>

      <section aria-labelledby="interfaces-heading" className="border-y border-border bg-[#F2F6F2] py-20 md:py-24">
        <div className="container-page grid items-center gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="section-label mb-3">The agent goes where you work</p>
            <h2 id="interfaces-heading" className="text-3xl font-semibold leading-[1.1] tracking-[-0.045em] text-ink sm:text-4xl">One workspace. <span className="text-forest">More than one way in.</span></h2>
            <p className="mt-5 max-w-lg text-sm leading-[1.85] text-ink-secondary">Keep the Nunuza workspace as your source of truth. Use Telegram for supported conversational controls, or connect compatible AI clients through remote MCP.</p>
            <p className="mt-4 text-xs leading-relaxed text-ink-muted">Available actions depend on your account, connection status, and enabled permissions.</p>
          </div>
          <div className="space-y-4">
            <article className="flex gap-5 rounded-2xl border border-border bg-white p-6 sm:p-7">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-forest-light text-forest"><MessageCircle size={22} /></span>
              <div><p className="text-[10px] font-semibold tracking-[0.15em] text-ink-muted">TELEGRAM</p><h3 className="mt-1 text-base font-semibold text-ink">Talk to your workflow.</h3><p className="mt-2 text-sm leading-relaxed text-ink-secondary">Bring an idea, ask about your content, and use supported bot actions without opening the dashboard for every interaction.</p></div>
            </article>
            <article className="flex gap-5 rounded-2xl border border-border bg-white p-6 sm:p-7">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-forest-light text-forest"><Command size={22} /></span>
              <div><p className="text-[10px] font-semibold tracking-[0.15em] text-ink-muted">REMOTE MCP</p><h3 className="mt-1 text-base font-semibold text-ink">Connect the tools you already use.</h3><p className="mt-2 text-sm leading-relaxed text-ink-secondary">Use supported Nunuza tools from compatible AI clients while keeping workspace data and permissions in Nunuza.</p></div>
            </article>
          </div>
        </div>
      </section>

      <section aria-labelledby="trust-heading" className="bg-forest py-20 md:py-28">
        <div className="container-page grid items-center gap-12 lg:grid-cols-[1fr_0.9fr]">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-white/60">Control is part of the product</p>
            <h2 id="trust-heading" className="mt-4 max-w-xl text-3xl font-semibold leading-[1.1] tracking-[-0.045em] text-white sm:text-4xl">Helpful doesn’t mean it gets to act without you.</h2>
            <p className="mt-5 max-w-xl text-sm leading-[1.85] text-white/75">Your content is yours. Review what the agent creates, decide what to change, and choose when to take the next step. LinkedIn actions remain subject to the permissions actually granted to the app.</p>
            <div className="mt-7 flex flex-wrap gap-x-5 gap-y-3 text-xs font-medium text-white/80">
              <span className="inline-flex items-center gap-2"><CheckCircle2 size={14} /> Review before action</span>
              <span className="inline-flex items-center gap-2"><CheckCircle2 size={14} /> Clear activity</span>
              <span className="inline-flex items-center gap-2"><CheckCircle2 size={14} /> Permission-aware</span>
            </div>
          </div>
          <div className="rounded-[1.5rem] border border-white/15 bg-white p-6 sm:p-8">
            <div className="flex items-center gap-3 border-b border-border pb-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-forest-light text-forest"><ShieldCheck size={20} /></div>
              <div><p className="text-sm font-semibold text-ink">You decide what happens</p><p className="mt-1 text-[11px] text-ink-muted">A deliberate workflow</p></div>
            </div>
            <div className="space-y-4 pt-5">
              {[
                ["01", "Nunuza prepares", "Ideas and drafts are shaped with your context."],
                ["02", "You review", "Read, edit, and decide whether it is ready."],
                ["03", "You choose the next step", "Only use connected actions that your account and permissions support."],
              ].map(([number, title, text]) => (
                <div key={number} className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-forest-light text-[11px] font-semibold text-forest">{number}</span>
                  <div><p className="text-sm font-semibold text-ink">{title}</p><p className="mt-1 text-xs leading-relaxed text-ink-secondary">{text}</p></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="faq" aria-labelledby="faq-heading" className="py-20 md:py-24">
        <div className="container-page grid gap-10 lg:grid-cols-[0.7fr_1.3fr]">
          <div><p className="section-label mb-3">The details</p><h2 id="faq-heading" className="text-3xl font-semibold tracking-[-0.045em] text-ink sm:text-4xl">Good questions. Clear answers.</h2><p className="mt-4 max-w-sm text-sm leading-relaxed text-ink-secondary">Know what the agent does, how it connects, and what to expect before you start.</p></div>
          <div className="divide-y divide-border border-y border-border">
            {faqs.map(({ question, answer }) => (
              <details key={question} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-5 text-sm font-semibold text-ink marker:content-none [&::-webkit-details-marker]:hidden">{question}<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border text-base font-normal text-ink-secondary transition-colors group-open:border-forest group-open:bg-forest group-open:text-white">+</span></summary>
                <p className="mt-3 max-w-2xl pr-10 text-sm leading-relaxed text-ink-secondary">{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section id="final-cta" aria-labelledby="final-cta-heading" className="border-t border-border bg-offwhite py-20 md:py-28">
        <div className="container-page text-center">
          <p className="section-label">Your work. Your voice. One connected agent.</p>
          <h2 id="final-cta-heading" className="mx-auto mt-4 max-w-3xl text-3xl font-semibold leading-[1.08] tracking-[-0.05em] text-ink sm:text-5xl">You bring the point of view. <span className="text-forest">Nunuza helps carry it forward.</span></h2>
          <p className="mx-auto mt-5 max-w-xl text-sm leading-[1.85] text-ink-secondary">Build a more consistent LinkedIn presence without starting from a blank prompt every time.</p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/login" id="final-cta-button" className="btn-primary justify-center px-7 py-3.5 text-sm">Start with Nunuza <ArrowRight size={17} /></Link>
            <Link href="/pricing" className="btn-secondary justify-center px-7 py-3.5 text-sm">View pricing <ArrowUpRight size={16} /></Link>
          </div>
        </div>
      </section>
    </>
  );
}
