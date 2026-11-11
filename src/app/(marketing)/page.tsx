import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight, AudioLines, CalendarDays, Check, CheckCircle2, Clock3,
  Linkedin, MessageCircle, Mic, MoreHorizontal, Send, Sparkles,
  WandSparkles, Workflow,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Nunuza — Build your presence",
  description: "Your content agent. Bring your ideas, shape them in your voice, and keep your content workflow moving.",
  openGraph: {
    title: "Nunuza — Build your presence",
    description: "One connected content agent for your ideas, drafts, and publishing workflow.",
    type: "website",
  },
};

const ink = "#202522";
const muted = "#68716C";
const green = "#174C3C";

function Avatar({ label = "N", tone = "green", size = "md" }: {
  label?: string; tone?: "green" | "cream" | "dark"; size?: "sm" | "md" | "lg";
}) {
  const tones = {
    green: "bg-[#E5EFE8] text-[#174C3C]",
    cream: "bg-[#F1EDE4] text-[#75664E]",
    dark: "bg-[#E9ECE9] text-[#34413A]",
  };
  const sizes = { sm: "h-7 w-7 text-[9px]", md: "h-9 w-9 text-[11px]", lg: "h-11 w-11 text-xs" };
  return <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${tones[tone]} ${sizes[size]}`}>{label}</span>;
}

function SectionHeading({ eyebrow, children, description, centered = false }: {
  eyebrow: string; children: ReactNode; description?: string; centered?: boolean;
}) {
  return <div className={`${centered ? "mx-auto text-center" : ""} max-w-[560px]`}>
    <p className="mb-3 text-[10px] font-semibold uppercase tracking-[.18em] text-[#929A93]">{eyebrow}</p>
    <h2 className="text-[2rem] font-semibold leading-[1.08] tracking-[-.055em] text-[#202522] sm:text-[2.75rem]">{children}</h2>
    {description && <p className="mt-5 text-sm leading-[1.9] text-[#68716C] sm:text-[15px]">{description}</p>}
  </div>;
}

function PostCard({ compact = false }: { compact?: boolean }) {
  return <article className={`overflow-hidden rounded-[17px] border border-[#E6EAE5] bg-white ${compact ? "shadow-[0_16px_45px_-32px_rgba(20,50,35,.32)]" : "shadow-[0_24px_65px_-38px_rgba(20,50,35,.32)]"}`}>
    <div className="flex items-center gap-2.5 border-b border-[#EEF0EC] px-4 py-3">
      <Avatar label="MA" size="sm" />
      <div className="min-w-0 flex-1"><p className="text-[11px] font-semibold text-[#303832]">Your LinkedIn profile</p><p className="text-[9px] text-[#929A93]">Post preview</p></div>
      <MoreHorizontal size={16} className="text-[#929A93]" />
    </div>
    <div className={compact ? "p-3.5" : "p-4"}>
      <p className="text-[12px] font-semibold leading-[1.65] text-[#303832]">The best product decisions rarely happen in a room by yourself.</p>
      <p className="mt-2 text-[10px] leading-[1.8] text-[#68716C]">They happen when you listen to the people using what you built. Five conversations taught me more than another week of guessing ever could.</p>
      <div className="mt-4 flex items-center justify-between border-t border-[#EEF0EC] pt-3">
        <span className="inline-flex items-center gap-1.5 text-[9px] text-[#68716C]"><CheckCircle2 size={11} className="text-[#287A50]" /> Voice guidance applied</span>
        <span className="text-[9px] font-semibold text-[#174C3C]">Review draft</span>
      </div>
    </div>
  </article>;
}

function ChatMessage({ from = "nunuza", children, time }: {
  from?: "nunuza" | "you"; children: ReactNode; time?: string;
}) {
  const user = from === "you";
  return <div className={`flex ${user ? "justify-end" : "justify-start"}`}>
    <div className={`max-w-[88%] rounded-[17px] px-4 py-3 ${user ? "rounded-br-[5px] bg-[#174C3C] text-white" : "rounded-bl-[5px] border border-[#E8ECE7] bg-white text-[#424A44]"}`}>
      <div className="text-[11px] leading-[1.8]">{children}</div>
      {time && <p className={`mt-2 text-right text-[9px] ${user ? "text-white/55" : "text-[#A0A69F]"}`}>{time}</p>}
    </div>
  </div>;
}

function HeroVisual() {
  return <div className="relative mx-auto w-full max-w-[690px] pb-5 pt-4 sm:pb-10">
    <div className="absolute left-[8%] top-[8%] h-[78%] w-[84%] rounded-full bg-[#E8F0EA] blur-[65px]" />
    <div className="relative grid grid-cols-12 items-center gap-3 sm:gap-4">
      <div className="col-span-8 col-start-1 row-start-1 z-10">
        <div className="overflow-hidden rounded-[23px] border border-[#E3E9E3] bg-white shadow-[0_30px_90px_-42px_rgba(23,76,60,.4)]">
          <div className="flex items-center justify-between border-b border-[#EEF0EC] px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#174C3C] text-white"><Sparkles size={15} /></span><div><p className="text-[11px] font-semibold text-[#202522]">Nunuza</p><p className="text-[9px] text-[#929A93]">Your content agent</p></div></div>
            <span className="rounded-full bg-[#EAF2EE] px-2.5 py-1 text-[8px] font-semibold text-[#174C3C]">Conversation preview</span>
          </div>
          <div className="space-y-3 bg-[#FAFBF9] p-3 sm:space-y-4 sm:p-5">
            <ChatMessage from="you" time="You · 9:41 AM">I learned more from our first five users than from a month of building alone. Turn that into a post.</ChatMessage>
            <ChatMessage time="Nunuza · 9:42 AM">I’ll build around that lesson and keep the detail that makes it yours.</ChatMessage>
            <div className="ml-2 sm:ml-8"><PostCard compact /></div>
          </div>
          <div className="flex items-center gap-2 border-t border-[#EEF0EC] bg-white px-3 py-3"><span className="flex-1 rounded-full bg-[#F5F7F4] px-4 py-2 text-[9px] text-[#A0A69F]">Message Nunuza…</span><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#174C3C] text-white"><Send size={11} /></span></div>
        </div>
      </div>
      <div className="col-span-5 col-start-8 row-start-1 z-20 mt-36 sm:mt-44">
        <div className="rounded-[18px] border border-[#E4E9E3] bg-white p-3 shadow-[0_20px_55px_-35px_rgba(23,76,60,.38)] sm:p-4">
          <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#EAF2EE] text-[#174C3C]"><MessageCircle size={13} /></span><p className="text-[10px] font-semibold text-[#303832]">Telegram</p><span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#3B9B69]" /></div>
          <p className="mt-3 text-[10px] leading-[1.7] text-[#68716C]">Your draft is ready. Want to make the opening more direct?</p>
          <div className="mt-3 rounded-xl bg-[#F5F7F4] px-3 py-2 text-[9px] text-[#68716C]">Make it stronger.</div>
          <div className="mt-2 rounded-xl bg-[#EAF2EE] px-3 py-2 text-[9px] text-[#174C3C]">Updated. Take a look.</div>
        </div>
      </div>
      <div className="col-span-5 col-start-2 row-start-1 z-20 -mt-[-205px] sm:-mt-[-255px]">
        <div className="flex items-center gap-2.5 rounded-[15px] border border-[#E4E9E3] bg-white px-3 py-3 shadow-[0_16px_45px_-32px_rgba(23,76,60,.4)]">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#EAF2EE] text-[#174C3C]"><Check size={14} /></span>
          <div><p className="text-[9px] font-semibold text-[#303832]">Ready for your review</p><p className="mt-0.5 text-[8px] text-[#929A93]">You stay in control of every post</p></div>
        </div>
      </div>
    </div>
  </div>;
}

function PlatformThread() {
  return <div className="relative mx-auto w-full max-w-[620px]">
    <div className="absolute -inset-8 rounded-full bg-[#EAF2EE] blur-[60px]" />
    <div className="relative rounded-[26px] border border-[#E4E9E3] bg-white p-3 shadow-[0_28px_75px_-45px_rgba(23,76,60,.34)] sm:p-5">
      <div className="flex items-center justify-between border-b border-[#EEF0EC] px-2 pb-4"><div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#174C3C] text-white"><Sparkles size={14} /></span><div><p className="text-[11px] font-semibold text-[#303832]">Nunuza</p><p className="text-[9px] text-[#929A93]">Connected conversation</p></div></div><span className="text-[9px] text-[#929A93]">Sample interaction</span></div>
      <div className="space-y-3 bg-[#FAFBF9] px-2 py-5 sm:px-4">
        <ChatMessage from="you" time="Today · 8:02 AM">I have an idea for a post about what changed after talking to customers.</ChatMessage>
        <ChatMessage time="Today · 8:03 AM">There’s a clear story here. I can help turn it into a draft using your writing preferences.</ChatMessage>
        <div className="ml-2 rounded-[15px] border border-[#E6EAE5] bg-white p-3 sm:ml-8"><div className="flex items-center gap-2"><Linkedin size={13} className="text-[#174C3C]" /><span className="text-[9px] font-semibold text-[#303832]">LinkedIn draft</span><span className="ml-auto rounded-full bg-[#EAF2EE] px-2 py-1 text-[8px] font-medium text-[#174C3C]">Review</span></div><p className="mt-2 text-[10px] font-semibold leading-relaxed text-[#303832]">Five conversations changed how I think about building products.</p><p className="mt-1 text-[9px] leading-[1.7] text-[#68716C]">I thought I knew where the friction was. Then I listened to the people actually using it.</p></div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EEF0EC] px-2 pt-4"><div className="flex items-center gap-2 text-[9px] text-[#68716C]"><MessageCircle size={13} className="text-[#174C3C]" /> Continue in Telegram or workspace</div><div className="flex items-center gap-1.5"><span className="rounded-full bg-[#F3F5F2] px-2.5 py-1 text-[8px] text-[#68716C]">Telegram</span><span className="rounded-full bg-[#EAF2EE] px-2.5 py-1 text-[8px] text-[#174C3C]">Workspace</span></div></div>
    </div>
  </div>;
}

const calendar = [
  { day: "MON", date: "12", time: "8:00 AM", title: "The lesson from our first five users", status: "Draft" },
  { day: "TUE", date: "13", time: "12:00 PM", title: "What changed after listening", status: "Review" },
  { day: "WED", date: "14", time: "6:00 PM", title: "A decision I would make differently", status: "Idea" },
  { day: "THU", date: "15", time: "9:00 AM", title: "The small detail users noticed", status: "Draft" },
  { day: "FRI", date: "16", time: "12:00 PM", title: "Building with real feedback", status: "Idea" },
];

function CalendarPreview() {
  return <div className="overflow-hidden rounded-[23px] border border-[#E4E9E3] bg-white shadow-[0_28px_75px_-45px_rgba(23,76,60,.34)]">
    <div className="flex items-center justify-between border-b border-[#EEF0EC] px-5 py-4"><div><p className="text-[12px] font-semibold text-[#303832]">Content calendar</p><p className="mt-1 text-[9px] text-[#929A93]">A sample week in your workspace</p></div><CalendarDays size={17} className="text-[#174C3C]" /></div>
    <div className="divide-y divide-[#EEF0EC]">{calendar.map((item) => <div key={item.day} className="flex items-center gap-3 px-4 py-3.5 sm:gap-4 sm:px-5"><div className="w-9 shrink-0 text-center"><p className="text-[8px] font-semibold tracking-wider text-[#929A93]">{item.day}</p><p className="text-[17px] font-semibold text-[#303832]">{item.date}</p></div><div className="h-9 w-px bg-[#E9EDE8]" /><div className="min-w-0 flex-1"><p className="text-[9px] text-[#929A93]">{item.time}</p><p className="mt-0.5 truncate text-[10px] font-medium text-[#424A44]">{item.title}</p></div><span className="rounded-full bg-[#F4F5F1] px-2.5 py-1 text-[8px] font-medium text-[#68716C]">{item.status}</span></div>)}</div>
    <div className="flex items-center gap-2 border-t border-[#EEF0EC] bg-[#FAFBF9] px-5 py-3 text-[9px] text-[#68716C]"><CheckCircle2 size={12} className="text-[#287A50]" /> Example plan · Edit every idea and draft</div>
  </div>;
}

function ExampleConversation({ label, prompt, response, time }: {
  label: string; prompt: string; response: string; time: string;
}) {
  return <article className="rounded-[18px] border border-[#E6EAE5] bg-white p-4 shadow-[0_18px_50px_-40px_rgba(23,76,60,.28)] sm:p-5">
    <div className="flex items-center gap-2.5"><Avatar size="sm" /><div><p className="text-[10px] font-semibold text-[#303832]">{label}</p><p className="text-[8px] text-[#929A93]">Example conversation</p></div><span className="ml-auto text-[8px] text-[#A0A69F]">{time}</span></div>
    <div className="mt-4 rounded-[13px] rounded-tr-[4px] bg-[#F5F7F4] p-3 text-[10px] leading-[1.75] text-[#68716C]">{prompt}</div>
    <div className="mt-2 rounded-[13px] rounded-tl-[4px] border border-[#E8ECE7] bg-white p-3 text-[10px] leading-[1.75] text-[#424A44]">{response}</div>
  </article>;
}

function InboxPreview() {
  return <div className="overflow-hidden rounded-[24px] border border-[#E4E9E3] bg-white shadow-[0_28px_75px_-45px_rgba(23,76,60,.34)]">
    <div className="flex items-center justify-between border-b border-[#EEF0EC] px-5 py-4"><div><p className="text-[12px] font-semibold text-[#303832]">Your conversations</p><p className="mt-1 text-[9px] text-[#929A93]">Pick up where you left off</p></div><span className="rounded-full bg-[#EAF2EE] px-2.5 py-1 text-[8px] font-semibold text-[#174C3C]">Inbox</span></div>
    <div className="grid min-h-[310px] sm:grid-cols-[.8fr_1.2fr]">
      <div className="border-b border-[#EEF0EC] bg-[#FAFBF9] p-3 sm:border-b-0 sm:border-r">
        {[["Content ideas","3 angles from your notes","8:02"],["Writing voice","Your draft is ready to review","Yesterday"],["Weekly plan","Updated your content outline","Mon"]].map(([title, preview, time], i) => <div key={title} className={`flex gap-2.5 rounded-xl p-3 ${i === 0 ? "bg-white shadow-sm" : ""}`}><Avatar size="sm" tone={i === 1 ? "cream" : "green"} /><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><p className="truncate text-[9px] font-semibold text-[#303832]">{title}</p><span className="text-[8px] text-[#A0A69F]">{time}</span></div><p className="mt-1 truncate text-[8px] text-[#929A93]">{preview}</p></div></div>)}
      </div>
      <div className="p-4 sm:p-5"><div className="mb-4 flex items-center gap-2.5 border-b border-[#EEF0EC] pb-3"><Avatar size="sm" /><div><p className="text-[10px] font-semibold text-[#303832]">Content ideas</p><p className="text-[8px] text-[#929A93]">Nunuza conversation</p></div></div>
        <div className="space-y-3"><ChatMessage from="you">Use the second angle. Keep it practical and make the opening stronger.</ChatMessage><ChatMessage>Naturally. I’ve tightened the opening and kept your original point. The revised draft is ready in your workspace.</ChatMessage></div>
        <div className="mt-5 flex items-center gap-2 rounded-full bg-[#F5F7F4] px-3 py-2.5 text-[9px] text-[#A0A69F]">Message Nunuza… <Send size={11} className="ml-auto text-[#174C3C]" /></div>
      </div>
    </div>
  </div>;
}

function VoiceWorkflow() {
  return <div className="mx-auto max-w-[620px] rounded-[24px] border border-[#E4E9E3] bg-white p-4 shadow-[0_28px_75px_-45px_rgba(23,76,60,.34)] sm:p-6">
    <div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#EAF2EE] text-[#174C3C]"><Mic size={15} /></span><span className="text-[10px] font-semibold text-[#303832]">Voice note · 0:41</span></div><span className="text-[8px] text-[#929A93]">Example workflow</span></div>
    <div className="my-5 flex h-9 items-center gap-[3px]">{Array.from({ length: 52 }, (_, i) => <span key={i} className="flex-1 rounded-full bg-[#C9DECE]" style={{ height: `${7 + ((i * 11) % 27)}px` }} />)}</div>
    <div className="rounded-[16px] bg-[#F7F9F6] p-4"><p className="text-[10px] leading-[1.8] text-[#68716C]">“I want to talk about the moment we realized our users were struggling with something completely different from what we expected…”</p></div>
    <div className="my-4 flex justify-center"><span className="rounded-full bg-[#EAF2EE] px-4 py-2 text-[8px] font-medium text-[#174C3C]">Nunuza shapes the thought into a draft</span></div>
    <PostCard compact />
    <div className="mt-4 grid grid-cols-3 gap-2">{[["01","Capture"],["02","Shape"],["03","Review"]].map(([n, label]) => <div key={n} className="rounded-xl bg-[#F5F7F4] px-2 py-3 text-center"><span className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-[#EAF2EE] text-[9px] font-semibold text-[#174C3C]">{n}</span><p className="mt-2 text-[9px] font-semibold text-[#515A53]">{label}</p></div>)}</div>
  </div>;
}

function DifferencePreview() {
  return <div className="grid gap-4 md:grid-cols-2">
    <article className="rounded-[22px] border border-[#E5E9E4] bg-[#F8F8F5] p-5 sm:p-7">
      <p className="text-[9px] font-semibold uppercase tracking-[.16em] text-[#929A93]">Without Nunuza</p>
      <div className="mt-5 rounded-[16px] border border-[#E7EBE6] bg-white p-4">
        <div className="flex items-center gap-2 text-[9px] text-[#929A93]"><Clock3 size={12} /> Sunday · 9:00 PM</div>
        <p className="mt-4 text-[12px] font-semibold text-[#303832]">Plan the whole week. Again.</p>
        <div className="mt-4 space-y-2"><div className="h-2 w-[88%] rounded-full bg-[#EEF0EC]" /><div className="h-2 w-[65%] rounded-full bg-[#EEF0EC]" /><div className="h-2 w-[76%] rounded-full bg-[#EEF0EC]" /></div>
        <p className="mt-5 text-[9px] text-[#929A93]">Scattered ideas. Blank drafts. Starting over.</p>
      </div>
    </article>
    <article className="rounded-[22px] border border-[#DCE8DF] bg-[#F1F6F2] p-5 sm:p-7">
      <p className="text-[9px] font-semibold uppercase tracking-[.16em] text-[#174C3C]">With Nunuza</p>
      <div className="mt-5 space-y-3 rounded-[16px] border border-[#E0E9E1] bg-white p-4">
        {[["3 ideas from your notes","Ready to explore"],["A draft in your voice","Ready for review"],["Your week at a glance","Content plan"]].map(([title, subtitle], i) => <div key={title} className="flex items-center gap-2.5 rounded-xl bg-[#F7F9F6] p-3"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#EAF2EE] text-[#174C3C]">{i === 0 ? <Sparkles size={12} /> : i === 1 ? <CheckCircle2 size={12} /> : <CalendarDays size={12} />}</span><div><p className="text-[9px] font-semibold text-[#303832]">{title}</p><p className="mt-0.5 text-[8px] text-[#929A93]">{subtitle}</p></div></div>)}
      </div>
    </article>
  </div>;
}

export default function HomePage() {
  return <>
    <section className="relative overflow-hidden bg-[#F8F8F5]">
      <div aria-hidden="true" className="pointer-events-none absolute -right-44 -top-48 h-[650px] w-[650px] rounded-full border border-[#E0E8E1]" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-[430px] w-[430px] rounded-full border border-[#E6ECE6]" />
      <div className="container-page relative grid items-center gap-5 pb-14 pt-14 md:pb-20 md:pt-20 lg:grid-cols-[.82fr_1.18fr] lg:gap-8 lg:py-24">
        <div className="relative z-10 max-w-[490px]">
          <h1 className="text-[3.15rem] font-semibold leading-[.98] tracking-[-.075em] text-[#202522] sm:text-[4.5rem]">Build your presence with <span className="text-[#174C3C]">Nunuza.</span></h1>
          <p className="mt-6 max-w-[390px] text-[15px] leading-[1.85] text-[#68716C]">Your content agent. Bring your ideas, find your voice, and keep your content moving.</p>
          <Link href="/login" className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#174C3C] px-6 py-3.5 text-[12px] font-semibold text-white transition-colors hover:bg-[#103B2F]">Message Nunuza <ArrowRight size={14} /></Link>
        </div>
        <HeroVisual />
      </div>
    </section>

    <section className="py-20 md:py-28">
      <div className="container-page grid items-center gap-12 lg:grid-cols-[.8fr_1.2fr] lg:gap-20">
        <SectionHeading eyebrow="One thread, across your workflow" description="Start in a conversation. Shape ideas, refine drafts, and continue in the Nunuza workspace or through supported connected tools.">One thread, <span className="text-[#174C3C]">across your workflow.</span></SectionHeading>
        <PlatformThread />
      </div>
    </section>

    <section className="border-y border-[#E7EBE6] bg-[#F8F8F5] py-20 md:py-28">
      <div className="container-page grid items-center gap-12 lg:grid-cols-[.8fr_1.2fr] lg:gap-20">
        <SectionHeading eyebrow="Content calendar" description="Turn loose ideas into a clear view of what you want to create. Keep the plan flexible as your priorities change.">Your week, <span className="text-[#174C3C]">already taking shape.</span></SectionHeading>
        <CalendarPreview />
      </div>
    </section>

    <section className="py-20 md:py-28">
      <div className="container-page">
        <SectionHeading centered eyebrow="A conversation that creates momentum" description="A few examples of how you can work with Nunuza." >Ideas in. <span className="text-[#174C3C]">Clear next steps out.</span></SectionHeading>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          <ExampleConversation label="Find an angle" time="9:41 AM" prompt="I want to write about the hardest part of launching our first version." response="The strongest angle is what surprised you after launch. Let's make that the opening." />
          <ExampleConversation label="Shape a draft" time="12:04 PM" prompt="Make this sound more like me. Less polished, more direct." response="I tightened the sentences, kept your original point, and removed the generic advice." />
          <ExampleConversation label="Plan the week" time="6:48 PM" prompt="Help me turn these three ideas into a realistic weekly plan." response="Here’s a suggested order. You can move, edit, or remove any item." />
        </div>
      </div>
    </section>

    <section className="border-y border-[#E7EBE6] bg-[#F8F8F5] py-20 md:py-28">
      <div className="container-page grid items-center gap-12 lg:grid-cols-[.78fr_1.22fr] lg:gap-20">
        <SectionHeading eyebrow="Your inbox" description="Ideas, drafts, and decisions stay connected. Pick up where you left off without digging through scattered conversations.">Everything stays <span className="text-[#174C3C]">in one thread.</span></SectionHeading>
        <InboxPreview />
      </div>
    </section>

    <section className="py-20 md:py-28">
      <div className="container-page grid gap-8 md:grid-cols-3">
        <article className="border-t border-[#C9DECE] pt-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EAF2EE] text-[#174C3C]"><Sparkles size={18} /></span>
          <p className="mt-7 text-[9px] font-semibold uppercase tracking-[.16em] text-[#929A93]">01</p>
          <h3 className="mt-2 text-[19px] font-semibold tracking-[-.035em] text-[#202522]">Proactive from day one.</h3>
          <p className="mt-3 text-[12px] leading-[1.85] text-[#68716C]">Nunuza helps surface angles, develop ideas, and give you a useful next step when you need one.</p>
        </article>
        <article className="border-t border-[#C9DECE] pt-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EAF2EE] text-[#174C3C]"><WandSparkles size={18} /></span>
          <p className="mt-7 text-[9px] font-semibold uppercase tracking-[.16em] text-[#929A93]">02</p>
          <h3 className="mt-2 text-[19px] font-semibold tracking-[-.035em] text-[#202522]">Drafts in your voice.</h3>
          <p className="mt-3 text-[12px] leading-[1.85] text-[#68716C]">Your voice guidance, examples, and preferences help each draft sound more like you.</p>
        </article>
        <article className="border-t border-[#C9DECE] pt-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EAF2EE] text-[#174C3C]"><AudioLines size={18} /></span>
          <p className="mt-7 text-[9px] font-semibold uppercase tracking-[.16em] text-[#929A93]">03</p>
          <h3 className="mt-2 text-[19px] font-semibold tracking-[-.035em] text-[#202522]">Learns what works.</h3>
          <p className="mt-3 text-[12px] leading-[1.85] text-[#68716C]">Use available performance signals to understand what connects and guide your next ideas.</p>
        </article>
      </div>
    </section>

    <section className="border-y border-[#E7EBE6] bg-[#F8F8F5] py-20 md:py-28">
      <div className="container-page grid items-center gap-12 lg:grid-cols-[.8fr_1.2fr] lg:gap-20">
        <SectionHeading eyebrow="The whole loop" description="Start with a rough thought or voice note. Nunuza helps shape it into a draft, you review it, and your next step stays clear.">You create. <span className="text-[#174C3C]">Nunuza keeps the work moving.</span></SectionHeading>
        <VoiceWorkflow />
      </div>
    </section>

    <section className="py-20 md:py-28">
      <div className="container-page">
        <SectionHeading centered eyebrow="A more connected way to create">Less starting over. <span className="text-[#174C3C]">More moving forward.</span></SectionHeading>
        <div className="mt-12"><DifferencePreview /></div>
      </div>
    </section>

    <section className="bg-[#174C3C] py-20 text-white md:py-24">
      <div className="container-page grid items-center gap-8 md:grid-cols-[1fr_auto]">
        <div><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-white/60">Your ideas. Your voice. Nunuza.</p><h2 className="mt-4 max-w-[650px] text-[2.25rem] font-semibold leading-[1.05] tracking-[-.06em] text-white sm:text-[3.5rem]">You create. <span className="text-[#C9DECE]">Nunuza keeps you moving.</span></h2></div>
        <Link href="/login" className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3.5 text-[12px] font-semibold text-[#174C3C] transition-colors hover:bg-[#EAF2EE]">Message Nunuza <ArrowRight size={14} /></Link>
      </div>
    </section>
  </>;
}
