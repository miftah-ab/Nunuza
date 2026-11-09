"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Circle, AlertCircle, Loader2 } from "lucide-react";
import { Logo } from "@/components/layout/Logo";

const ONBOARDING_STEPS = [
  { key: "welcome", label: "Welcome" },
  { key: "profile", label: "Professional profile" },
  { key: "audience", label: "Audience" },
  { key: "strategy", label: "Content strategy" },
  { key: "voice", label: "Voice profile" },
  { key: "cadence", label: "Cadence & schedule" },
  { key: "linkedin", label: "LinkedIn connection" },
] as const;

type StepKey = typeof ONBOARDING_STEPS[number]["key"];

interface OnboardingClientProps {
  initialDisplayName?: string | null;
  initialTimezone?: string | null;
}

export function OnboardingClient({
  initialDisplayName,
  initialTimezone,
}: OnboardingClientProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<StepKey>("welcome");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [displayName, setDisplayName] = useState(initialDisplayName || "");
  const [role, setRole] = useState("");
  const [company, setCompany] = useState("");
  const [positioning, setPositioning] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");

  const [audienceRoles, setAudienceRoles] = useState("");
  const [audienceProblems, setAudienceProblems] = useState("");
  const [audienceOutcomes, setAudienceOutcomes] = useState("");

  const [pillars, setPillars] = useState("Building in public\nFounder lessons\nProduct strategy\nTeam and hiring");
  const [primaryGoal, setPrimaryGoal] = useState("");
  const [exclusions, setExclusions] = useState("");
  const [ctaPreferences, setCtaPreferences] = useState("");

  const [tone, setTone] = useState("Direct, warm, slightly informal");
  const [sentenceLength, setSentenceLength] = useState("Short sentences, punchy paragraphs");
  const [phrasesUse, setPhrasesUse] = useState("");
  const [phrasesAvoid, setPhrasesAvoid] = useState("");
  const [sampleWriting, setSampleWriting] = useState("");

  const [postsPerWeek, setPostsPerWeek] = useState(3);
  const [preferredDays, setPreferredDays] = useState<number[]>([1, 2, 3, 4, 5]); // Mon–Fri
  const [timezone, setTimezone] = useState(initialTimezone || "UTC");

  const currentIndex = ONBOARDING_STEPS.findIndex((s) => s.key === currentStep);

  const goToStep = (step: StepKey) => {
    setError(null);
    setCurrentStep(step);
  };

  const handleNext = () => {
    if (currentIndex < ONBOARDING_STEPS.length - 1) {
      goToStep(ONBOARDING_STEPS[currentIndex + 1].key);
    }
  };

  const handleBack = () => {
    if (currentIndex > 0) {
      goToStep(ONBOARDING_STEPS[currentIndex - 1].key);
    }
  };

  const toggleDay = (dayIndex: number) => {
    if (preferredDays.includes(dayIndex)) {
      setPreferredDays(preferredDays.filter((d) => d !== dayIndex));
    } else {
      setPreferredDays([...preferredDays, dayIndex].sort());
    }
  };

  const handleFinishSetup = async () => {
    setIsSubmitting(true);
    setError(null);

    const payload = {
      displayName,
      role,
      company,
      positioning,
      linkedinUrl,
      audienceRoles,
      audienceProblems,
      audienceOutcomes,
      pillars,
      primaryGoal,
      exclusions,
      ctaPreferences,
      tone,
      sentenceLength,
      phrasesUse,
      phrasesAvoid,
      sampleWriting,
      postsPerWeek,
      preferredDays,
      timezone,
      finishSetup: true,
    };

    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = (await res.json()) as {
        error?: string;
        data?: { completed?: boolean };
      };

      if (!res.ok || json.error) {
        setError(json.error || "Failed to complete setup. Please try again.");
        setIsSubmitting(false);
        return;
      }

      if (json.data?.completed) {
        router.push("/app/overview");
        router.refresh();
      } else {
        setError("Setup response indicated incomplete state. Please retry.");
        setIsSubmitting(false);
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Network error completing setup."
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-offwhite flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between h-16 px-6 border-b border-border bg-white">
        <Logo height={24} asLink={false} />
        <span className="text-xs text-ink-secondary">
          Step {currentIndex + 1} of {ONBOARDING_STEPS.length}
        </span>
      </header>

      <div className="flex flex-1 max-w-4xl mx-auto w-full gap-8 p-6">
        {/* Step Sidebar */}
        <aside className="hidden md:block w-52 flex-shrink-0" aria-label="Onboarding steps">
          <nav>
            <ol className="space-y-1">
              {ONBOARDING_STEPS.map((step, i) => {
                const done = i < currentIndex;
                const active = i === currentIndex;
                return (
                  <li key={step.key}>
                    <button
                      type="button"
                      onClick={() => {
                        if (i <= currentIndex) goToStep(step.key);
                      }}
                      disabled={i > currentIndex}
                      className={`w-full flex items-center gap-2.5 py-1.5 text-left transition-colors ${i <= currentIndex ? "cursor-pointer" : "cursor-not-allowed opacity-60"
                        }`}
                    >
                      {done ? (
                        <CheckCircle2 size={16} className="text-success flex-shrink-0" aria-hidden="true" />
                      ) : (
                        <Circle
                          size={16}
                          className={active ? "text-forest" : "text-border"}
                          aria-hidden="true"
                        />
                      )}
                      <span className={`text-sm ${active ? "font-semibold text-ink" : "text-ink-secondary"}`}>
                        {step.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        </aside>

        {/* Step Content */}
        <main id="main-content" className="flex-1 card p-8 animate-fade-in">
          {error && (
            <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2.5">
              <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Setup Error</p>
                <p className="mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {/* STEP 1: WELCOME */}
          {currentStep === "welcome" && (
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
                <strong className="text-ink">Full v1.0.0 Content Operations:</strong> This setup configures
                your AI draft engine, audience targeting, and writing voice. Once completed, your workspace can
                generate tailored drafts, manage review cycles, and publish directly to LinkedIn according to your
                commercial subscription or private beta access.
              </div>
              <div className="mt-8 flex justify-end">
                <button
                  type="button"
                  onClick={handleNext}
                  className="btn-primary"
                >
                  Get started
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: PROFILE */}
          {currentStep === "profile" && (
            <div>
              <h1 className="text-xl font-bold text-ink mb-1">Professional profile</h1>
              <p className="text-sm text-ink-secondary mb-6">
                Tell Nunuza about you. This shapes every draft it generates.
              </p>
              <div className="space-y-4">
                <div>
                  <label htmlFor="display-name" className="block text-sm font-medium text-ink mb-1.5">
                    Display name
                  </label>
                  <input
                    id="display-name"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your name"
                    className="input-field"
                  />
                </div>
                <div>
                  <label htmlFor="role" className="block text-sm font-medium text-ink mb-1.5">
                    Role / title
                  </label>
                  <input
                    id="role"
                    type="text"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    placeholder="e.g. Founder, CEO"
                    className="input-field"
                  />
                </div>
                <div>
                  <label htmlFor="company" className="block text-sm font-medium text-ink mb-1.5">
                    Company or venture
                  </label>
                  <input
                    id="company"
                    type="text"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="e.g. Acme Inc."
                    className="input-field"
                  />
                </div>
                <div>
                  <label htmlFor="positioning" className="block text-sm font-medium text-ink mb-1.5">
                    Professional positioning <span className="text-ink-secondary font-normal">(optional)</span>
                  </label>
                  <textarea
                    id="positioning"
                    rows={3}
                    value={positioning}
                    onChange={(e) => setPositioning(e.target.value)}
                    placeholder="e.g. I help B2B founders grow through technical content..."
                    className="input-field resize-none"
                  />
                </div>
                <div>
                  <label htmlFor="linkedin-url" className="block text-sm font-medium text-ink mb-1.5">
                    LinkedIn profile URL <span className="text-ink-secondary font-normal">(optional)</span>
                  </label>
                  <input
                    id="linkedin-url"
                    type="url"
                    value={linkedinUrl}
                    onChange={(e) => setLinkedinUrl(e.target.value)}
                    placeholder="https://linkedin.com/in/..."
                    className="input-field"
                  />
                </div>
              </div>
              <div className="mt-8 flex justify-between">
                <button type="button" onClick={handleBack} className="btn-secondary">
                  Back
                </button>
                <button type="button" onClick={handleNext} className="btn-primary">
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: AUDIENCE */}
          {currentStep === "audience" && (
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
                  <textarea
                    id="audience-roles"
                    rows={2}
                    value={audienceRoles}
                    onChange={(e) => setAudienceRoles(e.target.value)}
                    placeholder="e.g. B2B SaaS founders, early-stage CTOs"
                    className="input-field resize-none"
                  />
                </div>
                <div>
                  <label htmlFor="audience-problems" className="block text-sm font-medium text-ink mb-1.5">
                    Problems your audience faces
                  </label>
                  <textarea
                    id="audience-problems"
                    rows={3}
                    value={audienceProblems}
                    onChange={(e) => setAudienceProblems(e.target.value)}
                    placeholder="e.g. Hard to get inbound leads without a large team..."
                    className="input-field resize-none"
                  />
                </div>
                <div>
                  <label htmlFor="audience-outcomes" className="block text-sm font-medium text-ink mb-1.5">
                    Desired outcomes for your audience
                  </label>
                  <textarea
                    id="audience-outcomes"
                    rows={2}
                    value={audienceOutcomes}
                    onChange={(e) => setAudienceOutcomes(e.target.value)}
                    placeholder="e.g. Build authority, attract design partners..."
                    className="input-field resize-none"
                  />
                </div>
              </div>
              <div className="mt-8 flex justify-between">
                <button type="button" onClick={handleBack} className="btn-secondary">
                  Back
                </button>
                <button type="button" onClick={handleNext} className="btn-primary">
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: STRATEGY */}
          {currentStep === "strategy" && (
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
                  <textarea
                    id="pillars"
                    rows={5}
                    value={pillars}
                    onChange={(e) => setPillars(e.target.value)}
                    className="input-field resize-none font-mono text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="primary-goal" className="block text-sm font-medium text-ink mb-1.5">
                    Primary goal
                  </label>
                  <input
                    id="primary-goal"
                    type="text"
                    value={primaryGoal}
                    onChange={(e) => setPrimaryGoal(e.target.value)}
                    placeholder="e.g. Attract design partners for my SaaS"
                    className="input-field"
                  />
                </div>
                <div>
                  <label htmlFor="exclusions" className="block text-sm font-medium text-ink mb-1.5">
                    Topics to avoid <span className="text-ink-secondary font-normal">(optional)</span>
                  </label>
                  <textarea
                    id="exclusions"
                    rows={2}
                    value={exclusions}
                    onChange={(e) => setExclusions(e.target.value)}
                    placeholder="e.g. Politics, religion, competitor comparisons"
                    className="input-field resize-none"
                  />
                </div>
                <div>
                  <label htmlFor="cta-preferences" className="block text-sm font-medium text-ink mb-1.5">
                    Preferred calls to action <span className="text-ink-secondary font-normal">(optional)</span>
                  </label>
                  <input
                    id="cta-preferences"
                    type="text"
                    value={ctaPreferences}
                    onChange={(e) => setCtaPreferences(e.target.value)}
                    placeholder="e.g. Book a call, reply with a question"
                    className="input-field"
                  />
                </div>
              </div>
              <div className="mt-8 flex justify-between">
                <button type="button" onClick={handleBack} className="btn-secondary">
                  Back
                </button>
                <button type="button" onClick={handleNext} className="btn-primary">
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* STEP 5: VOICE */}
          {currentStep === "voice" && (
            <div>
              <h1 className="text-xl font-bold text-ink mb-1">Voice profile</h1>
              <p className="text-sm text-ink-secondary mb-6">
                Describe how you write. Nunuza uses this in every generation.
              </p>
              <div className="space-y-4">
                <div>
                  <label htmlFor="tone" className="block text-sm font-medium text-ink mb-1.5">Tone</label>
                  <input
                    id="tone"
                    type="text"
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                    placeholder="e.g. Direct, warm, slightly informal"
                    className="input-field"
                  />
                </div>
                <div>
                  <label htmlFor="sentence-length" className="block text-sm font-medium text-ink mb-1.5">Sentence length</label>
                  <input
                    id="sentence-length"
                    type="text"
                    value={sentenceLength}
                    onChange={(e) => setSentenceLength(e.target.value)}
                    placeholder="e.g. Short sentences, punchy paragraphs"
                    className="input-field"
                  />
                </div>
                <div>
                  <label htmlFor="phrases-use" className="block text-sm font-medium text-ink mb-1.5">
                    Phrases/words you use <span className="text-ink-secondary font-normal">(optional, comma-separated)</span>
                  </label>
                  <input
                    id="phrases-use"
                    type="text"
                    value={phrasesUse}
                    onChange={(e) => setPhrasesUse(e.target.value)}
                    placeholder="e.g. ship it, real talk"
                    className="input-field"
                  />
                </div>
                <div>
                  <label htmlFor="phrases-avoid" className="block text-sm font-medium text-ink mb-1.5">
                    Phrases/words to avoid <span className="text-ink-secondary font-normal">(optional, comma-separated)</span>
                  </label>
                  <input
                    id="phrases-avoid"
                    type="text"
                    value={phrasesAvoid}
                    onChange={(e) => setPhrasesAvoid(e.target.value)}
                    placeholder="e.g. leverage, synergy, game-changer"
                    className="input-field"
                  />
                </div>
                <div>
                  <label htmlFor="sample-writing" className="block text-sm font-medium text-ink mb-1.5">
                    Sample writing <span className="text-ink-secondary font-normal">(optional — paste a post you&apos;ve written)</span>
                  </label>
                  <textarea
                    id="sample-writing"
                    rows={4}
                    value={sampleWriting}
                    onChange={(e) => setSampleWriting(e.target.value)}
                    placeholder="Paste a LinkedIn post or any writing that represents your voice..."
                    className="input-field resize-none"
                  />
                </div>
              </div>
              <div className="mt-8 flex justify-between">
                <button type="button" onClick={handleBack} className="btn-secondary">
                  Back
                </button>
                <button type="button" onClick={handleNext} className="btn-primary">
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* STEP 6: CADENCE */}
          {currentStep === "cadence" && (
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
                  <select
                    id="posts-per-week"
                    value={postsPerWeek}
                    onChange={(e) => setPostsPerWeek(parseInt(e.target.value, 10))}
                    className="input-field"
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>{n} post{n > 1 ? "s" : ""} per week</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="preferred-days" className="block text-sm font-medium text-ink mb-1.5">
                    Preferred posting days
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
                      <label key={d} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={preferredDays.includes(i)}
                          onChange={() => toggleDay(i)}
                          className="accent-forest"
                        />
                        <span className="text-sm text-ink">{d}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label htmlFor="timezone" className="block text-sm font-medium text-ink mb-1.5">
                    Your time zone
                  </label>
                  <input
                    id="timezone"
                    type="text"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    placeholder="e.g. Europe/Istanbul, America/New_York"
                    className="input-field"
                  />
                  <p className="text-xs text-ink-secondary mt-1">
                    Enter an IANA time zone name. Scheduled times will be shown in this zone.
                  </p>
                </div>
              </div>
              <div className="mt-8 flex justify-between">
                <button type="button" onClick={handleBack} className="btn-secondary">
                  Back
                </button>
                <button type="button" onClick={handleNext} className="btn-primary">
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* STEP 7: LINKEDIN */}
          {currentStep === "linkedin" && (
            <div>
              <h1 className="text-xl font-bold text-ink mb-1">LinkedIn connection</h1>
              <p className="text-sm text-ink-secondary mb-6">
                Connect your personal LinkedIn profile for automated drafting and direct-to-feed publishing.
              </p>
              <div className="card border-forest-muted bg-forest-light/40 p-4 mb-6 text-sm text-ink-secondary">
                <strong className="text-ink">Direct Publishing Integration:</strong> Connecting your personal
                profile grants secure publishing permissions via LinkedIn OAuth. You can connect now or link
                your profile anytime from Workspace Integrations.
              </div>
              <div className="card p-5 text-center">
                <p className="text-sm font-medium text-ink mb-1">LinkedIn OAuth Available</p>
                <p className="text-xs text-ink-secondary">
                  You can connect your LinkedIn account anytime from Workspace Integrations.
                </p>
              </div>

              <div className="mt-8 flex justify-between items-center">
                <button
                  type="button"
                  onClick={handleBack}
                  disabled={isSubmitting}
                  className="btn-secondary"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleFinishSetup}
                  disabled={isSubmitting}
                  className="btn-primary flex items-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Finishing setup...</span>
                    </>
                  ) : (
                    <span>Finish setup</span>
                  )}
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
