import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Logo } from "@/components/layout/Logo";
import { CheckCircle2, Circle } from "lucide-react";

export const metadata: Metadata = {
  title: "Get started",
  robots: { index: false, follow: false },
};

// Onboarding steps per spec §6
const ONBOARDING_STEPS = [
  { key: "welcome",   label: "Welcome" },
  { key: "profile",   label: "Professional profile" },
  { key: "audience",  label: "Audience" },
  { key: "strategy",  label: "Content strategy" },
  { key: "voice",     label: "Voice profile" },
  { key: "cadence",   label: "Cadence & schedule" },
  { key: "linkedin",  label: "LinkedIn connection" },
] as const;

type OnboardingStepKey = typeof ONBOARDING_STEPS[number]["key"];

function getCurrentStep(searchParams: Record<string, string | undefined>): OnboardingStepKey {
  const step = searchParams.step as OnboardingStepKey | undefined;
  const valid = ONBOARDING_STEPS.map((s) => s.key);
  if (step && valid.includes(step as OnboardingStepKey)) return step as OnboardingStepKey;
  return "welcome";
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // If already set up, redirect to overview
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("state, entitlement_type")
    .eq("owner_user_id", user.id)
    .single();

  if (workspace && workspace.state !== "setup_required") {
    redirect("/app/overview");
  }

  const params = await searchParams;
  const currentStep = getCurrentStep(params);
  const currentIndex = ONBOARDING_STEPS.findIndex((s) => s.key === currentStep);

  return (
    <div className="min-h-screen bg-offwhite flex flex-col">
      {/* Minimal header */}
      <header className="flex items-center justify-between h-16 px-6 border-b border-border bg-white">
        <Logo height={24} asLink={false} />
        <span className="text-xs text-ink-secondary">
          Step {currentIndex + 1} of {ONBOARDING_STEPS.length}
        </span>
      </header>

      <div className="flex flex-1 max-w-4xl mx-auto w-full gap-8 p-6">
        {/* Step sidebar */}
        <aside className="hidden md:block w-52 flex-shrink-0" aria-label="Onboarding steps">
          <nav>
            <ol className="space-y-1">
              {ONBOARDING_STEPS.map((step, i) => {
                const done = i < currentIndex;
                const active = i === currentIndex;
                return (
                  <li key={step.key} className="flex items-center gap-2.5 py-1.5">
                    {done ? (
                      <CheckCircle2 size={16} className="text-success flex-shrink-0" aria-hidden="true" />
                    ) : (
                      <Circle
                        size={16}
                        className={active ? "text-forest" : "text-border"}
                        aria-hidden="true"
                      />
                    )}
                    <span className={`text-sm ${active ? "font-semibold text-ink" : done ? "text-ink-secondary" : "text-ink-secondary"}`}>
                      {step.label}
                    </span>
                  </li>
                );
              })}
            </ol>
          </nav>
        </aside>

        {/* Step content */}
        <main id="main-content" className="flex-1 card p-8 animate-fade-in">
          <OnboardingStepContent step={currentStep} userId={user.id} />
        </main>
      </div>
    </div>
  );
}

function OnboardingStepContent({
  step,
  userId,
}: {
  step: OnboardingStepKey;
  userId: string;
}) {
  switch (step) {
    case "welcome":
      return <WelcomeStep />;
    case "profile":
      return <ProfileStep />;
    case "audience":
      return <AudienceStep />;
    case "strategy":
      return <StrategyStep />;
    case "voice":
      return <VoiceStep />;
    case "cadence":
      return <CadenceStep />;
    case "linkedin":
      return <LinkedInStep />;
    default:
      return <WelcomeStep />;
  }
}

function StepNav({ next, nextLabel = "Continue" }: { next: string; nextLabel?: string }) {
  return (
    <div className="mt-8 flex justify-end">
      <Link href={next} className="btn-primary">
        {nextLabel}
      </Link>
    </div>
  );
}

function WelcomeStep() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-ink mb-2">Welcome to Nunuza</h1>
      <p className="text-ink-secondary mb-6">
        Let&apos;s set up your workspace in a few steps. This takes about 5 minutes and
        everything can be updated later from the dashboard.
      </p>
      <div className="space-y-3 mb-6">
        <p className="text-sm text-ink">
          <strong>What we&apos;ll set up:</strong>
        </p>
        <ul className="space-y-1.5 text-sm text-ink-secondary">
          <li>• Your professional profile and positioning</li>
          <li>• Target audience and goals</li>
          <li>• Content pillars and strategy</li>
          <li>• Your writing voice and preferences</li>
          <li>• Posting cadence and time zone</li>
        </ul>
      </div>
      <div className="rounded-lg bg-forest-light border border-forest-muted p-4 text-sm text-ink-secondary">
        <strong className="text-ink">Draft-only preview:</strong> This setup supports
        drafting, review, and export. Publishing and scheduling are unavailable in this
        release. LinkedIn connection is optional during the preview.
      </div>
      <StepNav next="/app/onboarding?step=profile" nextLabel="Get started" />
    </div>
  );
}

function ProfileStep() {
  return (
    <div>
      <h1 className="text-xl font-bold text-ink mb-1">Professional profile</h1>
      <p className="text-sm text-ink-secondary mb-6">
        Tell Nunuza about you. This shapes every draft it generates.
      </p>
      {/* Phase 3: wire to server action + DB */}
      <div className="space-y-4">
        <div>
          <label htmlFor="display-name" className="block text-sm font-medium text-ink mb-1.5">
            Display name
          </label>
          <input id="display-name" type="text" placeholder="Your name" className="input-field" />
        </div>
        <div>
          <label htmlFor="role" className="block text-sm font-medium text-ink mb-1.5">
            Role / title
          </label>
          <input id="role" type="text" placeholder="e.g. Founder, CEO" className="input-field" />
        </div>
        <div>
          <label htmlFor="company" className="block text-sm font-medium text-ink mb-1.5">
            Company or venture
          </label>
          <input id="company" type="text" placeholder="e.g. Acme Inc." className="input-field" />
        </div>
        <div>
          <label htmlFor="positioning" className="block text-sm font-medium text-ink mb-1.5">
            Professional positioning <span className="text-ink-secondary font-normal">(optional)</span>
          </label>
          <textarea
            id="positioning"
            rows={3}
            placeholder="e.g. I help B2B founders grow through technical content..."
            className="input-field resize-none"
          />
        </div>
        <div>
          <label htmlFor="linkedin-url" className="block text-sm font-medium text-ink mb-1.5">
            LinkedIn profile URL <span className="text-ink-secondary font-normal">(optional)</span>
          </label>
          <input id="linkedin-url" type="url" placeholder="https://linkedin.com/in/..." className="input-field" />
        </div>
      </div>
      <StepNav next="/app/onboarding?step=audience" />
    </div>
  );
}

function AudienceStep() {
  return (
    <div>
      <h1 className="text-xl font-bold text-ink mb-1">Target audience</h1>
      <p className="text-sm text-ink-secondary mb-6">
        Who are you writing for? The more specific, the better.
      </p>
      <div className="space-y-4">
        <div>
          <label htmlFor="audience-roles" className="block text-sm font-medium text-ink mb-1.5">
            Target roles and industries
          </label>
          <textarea id="audience-roles" rows={2} placeholder="e.g. B2B SaaS founders, early-stage CTOs" className="input-field resize-none" />
        </div>
        <div>
          <label htmlFor="audience-problems" className="block text-sm font-medium text-ink mb-1.5">
            Problems your audience faces
          </label>
          <textarea id="audience-problems" rows={3} placeholder="e.g. Hard to get inbound leads without a large team..." className="input-field resize-none" />
        </div>
        <div>
          <label htmlFor="audience-outcomes" className="block text-sm font-medium text-ink mb-1.5">
            Desired outcomes for your audience
          </label>
          <textarea id="audience-outcomes" rows={2} placeholder="e.g. Build authority, attract design partners..." className="input-field resize-none" />
        </div>
      </div>
      <StepNav next="/app/onboarding?step=strategy" />
    </div>
  );
}

function StrategyStep() {
  return (
    <div>
      <h1 className="text-xl font-bold text-ink mb-1">Content strategy</h1>
      <p className="text-sm text-ink-secondary mb-6">
        Define 3–5 content pillars — the recurring themes your posts will cover.
      </p>
      <div className="space-y-4">
        <div>
          <label htmlFor="pillars" className="block text-sm font-medium text-ink mb-1.5">
            Content pillars <span className="text-ink-secondary font-normal">(one per line, 3–5)</span>
          </label>
          <textarea id="pillars" rows={5} placeholder={"Building in public\nFounder lessons\nProduct strategy\nTeam and hiring"} className="input-field resize-none font-mono text-sm" />
        </div>
        <div>
          <label htmlFor="primary-goal" className="block text-sm font-medium text-ink mb-1.5">
            Primary goal
          </label>
          <input id="primary-goal" type="text" placeholder="e.g. Attract design partners for my SaaS" className="input-field" />
        </div>
        <div>
          <label htmlFor="exclusions" className="block text-sm font-medium text-ink mb-1.5">
            Topics to avoid <span className="text-ink-secondary font-normal">(optional)</span>
          </label>
          <textarea id="exclusions" rows={2} placeholder="e.g. Politics, religion, competitor comparisons" className="input-field resize-none" />
        </div>
        <div>
          <label htmlFor="cta-preferences" className="block text-sm font-medium text-ink mb-1.5">
            Preferred calls to action <span className="text-ink-secondary font-normal">(optional)</span>
          </label>
          <input id="cta-preferences" type="text" placeholder="e.g. Book a call, reply with a question" className="input-field" />
        </div>
      </div>
      <StepNav next="/app/onboarding?step=voice" />
    </div>
  );
}

function VoiceStep() {
  return (
    <div>
      <h1 className="text-xl font-bold text-ink mb-1">Voice profile</h1>
      <p className="text-sm text-ink-secondary mb-6">
        Describe how you write. Nunuza uses this in every generation.
      </p>
      <div className="space-y-4">
        <div>
          <label htmlFor="tone" className="block text-sm font-medium text-ink mb-1.5">Tone</label>
          <input id="tone" type="text" placeholder="e.g. Direct, warm, slightly informal" className="input-field" />
        </div>
        <div>
          <label htmlFor="sentence-length" className="block text-sm font-medium text-ink mb-1.5">Sentence length</label>
          <input id="sentence-length" type="text" placeholder="e.g. Short sentences, punchy paragraphs" className="input-field" />
        </div>
        <div>
          <label htmlFor="phrases-use" className="block text-sm font-medium text-ink mb-1.5">
            Phrases/words you use <span className="text-ink-secondary font-normal">(optional)</span>
          </label>
          <input id="phrases-use" type="text" placeholder="e.g. 'ship it', 'real talk'" className="input-field" />
        </div>
        <div>
          <label htmlFor="phrases-avoid" className="block text-sm font-medium text-ink mb-1.5">
            Phrases/words to avoid <span className="text-ink-secondary font-normal">(optional)</span>
          </label>
          <input id="phrases-avoid" type="text" placeholder="e.g. 'leverage', 'synergy', 'game-changer'" className="input-field" />
        </div>
        <div>
          <label htmlFor="sample-writing" className="block text-sm font-medium text-ink mb-1.5">
            Sample writing <span className="text-ink-secondary font-normal">(optional — paste a post you&apos;ve written)</span>
          </label>
          <textarea id="sample-writing" rows={4} placeholder="Paste a LinkedIn post or any writing that represents your voice..." className="input-field resize-none" />
        </div>
      </div>
      <StepNav next="/app/onboarding?step=cadence" />
    </div>
  );
}

function CadenceStep() {
  return (
    <div>
      <h1 className="text-xl font-bold text-ink mb-1">Cadence and schedule</h1>
      <p className="text-sm text-ink-secondary mb-6">
        How often do you want to post? This sets the draft generation rhythm.
      </p>
      <div className="space-y-4">
        <div>
          <label htmlFor="posts-per-week" className="block text-sm font-medium text-ink mb-1.5">
            Target posts per week
          </label>
          <select id="posts-per-week" className="input-field">
            {[1,2,3,4,5].map(n => (
              <option key={n} value={n}>{n} post{n > 1 ? "s" : ""} per week</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="preferred-days" className="block text-sm font-medium text-ink mb-1.5">
            Preferred posting days
          </label>
          <div className="flex flex-wrap gap-2">
            {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d, i) => (
              <label key={d} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" value={i} className="accent-forest" />
                <span className="text-sm text-ink">{d}</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="timezone" className="block text-sm font-medium text-ink mb-1.5">
            Your time zone
          </label>
          <input id="timezone" type="text" placeholder="e.g. Europe/Istanbul, America/New_York" className="input-field" defaultValue="UTC" />
          <p className="text-xs text-ink-secondary mt-1">
            Enter an IANA time zone name. Scheduled times will be shown in this zone.
          </p>
        </div>
      </div>
      <StepNav next="/app/onboarding?step=linkedin" />
    </div>
  );
}

function LinkedInStep() {
  return (
    <div>
      <h1 className="text-xl font-bold text-ink mb-1">LinkedIn connection</h1>
      <p className="text-sm text-ink-secondary mb-6">
        Connecting LinkedIn allows Nunuza to check your profile. Publishing is not
        available in this draft-only preview.
      </p>
      <div className="card border-forest-muted bg-forest-light/40 p-4 mb-6 text-sm text-ink-secondary">
        <strong className="text-ink">Draft-only preview:</strong> LinkedIn connection
        is optional here. Publishing requires a separate beta provisioning step and is
        not available to draft-only workspaces.
      </div>
      <div className="card p-5 text-center">
        <p className="text-sm font-medium text-ink mb-1">Integration not enabled</p>
        <p className="text-xs text-ink-secondary">
          LinkedIn OAuth will be enabled after the API access gate passes.
        </p>
      </div>
      {/* Complete onboarding — Phase 3 will wire the server action */}
      <div className="mt-8 flex justify-end">
        <Link href="/app/overview" className="btn-primary">
          Finish setup
        </Link>
      </div>
    </div>
  );
}
