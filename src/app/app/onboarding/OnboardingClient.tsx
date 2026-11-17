"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Check, Loader2, Plus, Send } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import {
  AUDIENCE_OPTIONS,
  CADENCE_OPTIONS,
  GOAL_OPTIONS,
  ROLE_OPTIONS,
  TONE_OPTIONS,
  buildOnboardingPayload,
  cleanAnswer,
  suggestTopics,
} from "./onboarding-options";

type StepKey = "name" | "role" | "goals" | "audience" | "topics" | "tone" | "cadence" | "connect";
const QUESTION_STEPS: StepKey[] = ["role", "goals", "audience", "topics", "tone", "cadence", "connect"];

interface OnboardingClientProps {
  initialDisplayName?: string | null;
  initialTimezone?: string | null;
}

/** One selectable option. Custom answers added through "Other" appear as chips too. */
function ChipGroup({
  label,
  options,
  value,
  onChange,
  multiple,
  otherLabel = "Other",
  onSingleChosen,
}: {
  label: string;
  options: readonly { value: string; hint?: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  multiple: boolean;
  otherLabel?: string;
  /** Called after a single-choice tap so the flow can move on. */
  onSingleChosen?: () => void;
}) {
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState("");
  const known = new Set(options.map((o) => o.value));
  const custom = value.filter((v) => !known.has(v));

  const toggle = (v: string) => {
    if (multiple) {
      onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
    } else {
      onChange([v]);
      setOtherOpen(false);
      onSingleChosen?.();
    }
  };

  const addOther = () => {
    const text = cleanAnswer(otherText);
    if (!text) return;
    if (multiple) {
      if (!value.includes(text)) onChange([...value, text]);
      setOtherText("");
    } else {
      onChange([text]);
      setOtherOpen(false);
      onSingleChosen?.();
    }
  };

  const chip = (selected: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-4 py-3 text-[15px] font-medium sm:py-2.5 sm:text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 ${
      selected
        ? "border-forest bg-forest text-white"
        : "border-border bg-white text-ink hover:border-forest-muted hover:bg-forest-light"
    }`;

  return (
    <div role={multiple ? "group" : "radiogroup"} aria-label={label}>
      <div className="flex flex-wrap gap-2.5">
        {options.map((o) => {
          const selected = value.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              role={multiple ? undefined : "radio"}
              aria-checked={multiple ? undefined : selected}
              aria-pressed={multiple ? selected : undefined}
              onClick={() => toggle(o.value)}
              title={o.hint}
              className={chip(selected)}
            >
              {selected && multiple && <Check size={14} aria-hidden="true" />}
              <span>{o.value}</span>
            </button>
          );
        })}
        {custom.map((v) => (
          <button
            key={v}
            type="button"
            role={multiple ? undefined : "radio"}
            aria-checked={multiple ? undefined : true}
            aria-pressed={multiple ? true : undefined}
            onClick={() => onChange(value.filter((x) => x !== v))}
            className={chip(true)}
            title="Tap to remove"
          >
            <Check size={14} aria-hidden="true" />
            <span>{v}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOtherOpen((open) => !open)}
          aria-expanded={otherOpen}
          className={chip(false) + " border-dashed"}
        >
          <Plus size={14} aria-hidden="true" />
          <span>{otherLabel}</span>
        </button>
      </div>

      {otherOpen && (
        <div className="mt-4 flex gap-2">
          <input
            autoFocus
            type="text"
            maxLength={80}
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addOther();
              }
            }}
            placeholder="Type your own"
            aria-label={`${otherLabel}: type your own`}
            className="input-field flex-1"
          />
          <button type="button" onClick={addOther} disabled={!cleanAnswer(otherText)} className="btn-primary">
            Add
          </button>
        </div>
      )}
    </div>
  );
}

export function OnboardingClient({ initialDisplayName, initialTimezone }: OnboardingClientProps) {
  const router = useRouter();
  // The name comes from the sign-in, so it is only asked when it is missing.
  const hasName = Boolean(initialDisplayName?.trim());
  const STEPS = useMemo<StepKey[]>(() => (hasName ? QUESTION_STEPS : ["name", ...QUESTION_STEPS]), [hasName]);
  const [step, setStep] = useState<StepKey>(STEPS[0]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"finish" | "linkedin" | "telegram" | null>(null);

  const [displayName, setDisplayName] = useState(initialDisplayName || "");
  const [roles, setRoles] = useState<string[]>([]);
  const [goals, setGoals] = useState<string[]>([]);
  const [audience, setAudience] = useState<string[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [tones, setTones] = useState<string[]>([]);
  const [postsPerWeek, setPostsPerWeek] = useState(3);
  // Detect the timezone instead of asking for it.
  const [timezone] = useState(() => {
    if (initialTimezone && initialTimezone !== "UTC") return initialTimezone;
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  });
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [telegramOpened, setTelegramOpened] = useState(false);
  const [telegramSkipped, setTelegramSkipped] = useState(false);
  const topicsSeeded = useRef(false);

  const index = STEPS.indexOf(step);

  const payload = useCallback(
    () => buildOnboardingPayload({ displayName, roles, goals, audience, topics, tones, postsPerWeek, timezone }),
    [displayName, roles, goals, audience, topics, tones, postsPerWeek, timezone]
  );

  // Save after every answer so a refresh or a closed tab loses nothing.
  const saveProgress = useCallback(
    (leaving: StepKey) => {
      void fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload(), onboardingStep: leaving }),
      }).catch(() => {});
    },
    [payload]
  );

  const go = (next: StepKey) => {
    setError(null);
    setStep(next);
  };

  const goNext = () => {
    saveProgress(step);
    const next = STEPS[index + 1];
    if (next === "topics" && !topicsSeeded.current) {
      topicsSeeded.current = true;
      if (topics.length === 0) setTopics(suggestTopics(roles).slice(0, 4));
    }
    if (next) go(next);
  };

  const goNextRef = useRef(goNext);
  useEffect(() => {
    goNextRef.current = goNext;
  });

  const goBack = () => {
    const prev = STEPS[index - 1];
    if (prev) go(prev);
  };

  const finish = async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload(), finishSetup: true, onboardingStep: "connect" }),
      });
      const json = (await res.json()) as { error?: string; data?: { completed?: boolean } };
      if (!res.ok || json.error || !json.data?.completed) {
        setError(json.error || "We couldn’t finish setting up your workspace. Please try again.");
        return false;
      }
      return true;
    } catch {
      setError("We couldn’t save your setup. Check your connection and try again.");
      return false;
    }
  };

  const handleStart = async () => {
    setBusy("finish");
    setError(null);
    if (await finish()) {
      setDone(true);
      setTimeout(() => {
        router.push("/app/overview");
        router.refresh();
      }, 1400);
      return;
    }
    setBusy(null);
  };

  const handleLinkedIn = async () => {
    setBusy("linkedin");
    setError(null);
    if (await finish()) {
      window.location.href = "/api/integrations/linkedin/authorize";
      return;
    }
    setBusy(null);
  };

  const handleTelegram = async () => {
    setBusy("telegram");
    setError(null);
    try {
      const res = await fetch("/api/integrations/telegram/link", { method: "POST" });
      const json = (await res.json()) as { error?: string; data?: { botUrl?: string } };
      const botUrl = json.data?.botUrl;
      if (!res.ok || !botUrl) throw new Error(json.error || "link");
      window.open(botUrl, "_blank", "noopener,noreferrer");
      setTelegramOpened(true);
    } catch {
      setError("We couldn’t create your Telegram link. Please try again.");
    }
    setBusy(null);
  };

  // After Telegram opens, watch for the link to complete.
  useEffect(() => {
    if (!telegramOpened || telegramConnected) return;
    let stopped = false;
    const started = Date.now();
    const timer = setInterval(async () => {
      if (stopped || Date.now() - started > 5 * 60 * 1000) {
        clearInterval(timer);
        return;
      }
      try {
        const res = await fetch("/api/integrations/telegram/link");
        const json = (await res.json()) as { data?: { status?: { connected?: boolean } } };
        if (json.data?.status?.connected) {
          setTelegramConnected(true);
          clearInterval(timer);
        }
      } catch {
        // keep polling
      }
    }, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [telegramOpened, telegramConnected]);

  const topicOptions = suggestTopics(roles).map((value) => ({ value }));
  const questionCount = STEPS.length - 1;
  const firstName = cleanAnswer(displayName, 40).split(" ")[0];

  // Mobile: the action bar sticks to the bottom so it stays under the thumb.
  const footerClass =
    "sticky bottom-0 -mx-6 mt-10 flex items-center justify-between border-t border-border bg-white/95 px-6 py-4 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0";

  const renderFooter = ({ canSkip = true }: { canSkip?: boolean } = {}) => (
    <div className={footerClass}>
      <button type="button" onClick={goBack} className="btn-secondary" aria-label="Back" disabled={index === 0}>
        <ArrowLeft size={16} aria-hidden="true" />
        Back
      </button>
      <div className="flex items-center gap-4">
        {canSkip && (
          <button type="button" onClick={goNext} className="text-sm text-ink-secondary hover:text-ink underline-offset-4 hover:underline">
            Skip
          </button>
        )}
        <button type="button" onClick={goNext} className="btn-primary">
          Continue
        </button>
      </div>
    </div>
  );

  const renderTitle = (children: React.ReactNode, hint?: string) => (
    <div className="mb-7">
      <h1 className="text-[26px] leading-tight font-bold tracking-tight text-ink sm:text-3xl">{children}</h1>
      {hint && <p className="mt-2 text-[15px] text-ink-secondary">{hint}</p>}
    </div>
  );

  if (done) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 text-center animate-slide-up">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-forest text-white" aria-hidden="true">
          <Check size={32} strokeWidth={3} />
        </span>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-ink">You&apos;re set{firstName ? `, ${firstName}` : ""}.</h1>
        <p className="mt-2 max-w-sm text-[15px] text-ink-secondary" role="status">
          Your agent is ready. Taking you to your dashboard…
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="flex items-center justify-between h-16 px-6 border-b border-border bg-white">
        <Logo height={24} asLink={false} />
        {step !== "connect" && (
          <span className="text-xs text-ink-secondary">{index + 1} of {questionCount}</span>
        )}
      </header>
      <div
        className="flex gap-1.5 px-6 pt-4 max-w-5xl mx-auto w-full"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={STEPS.length}
        aria-valuenow={index + 1}
        aria-label="Setup progress"
      >
        {STEPS.map((key, i) => (
          <span
            key={key}
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${i <= index ? "bg-forest" : "bg-forest-light"}`}
          />
        ))}
      </div>

      <div className="flex-1 w-full max-w-5xl mx-auto px-6 py-8 sm:py-14 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-16">
        <main id="main-content" className="w-full max-w-xl">
          {error && (
            <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2.5" role="alert">
              <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <p>{error}</p>
            </div>
          )}

          <div key={step} className="animate-slide-up">
            {step === "name" && (
              <div>
                {renderTitle("What should we call you?")}
                <input
                  id="display-name"
                  type="text"
                  maxLength={60}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") goNext();
                  }}
                  placeholder="Your name"
                  aria-label="Your name"
                  autoComplete="name"
                  autoFocus
                  className="input-field w-full"
                />
                {renderFooter({ canSkip: false })}
              </div>
            )}

            {step === "role" && (
              <div>
                {renderTitle(firstName ? `Hi ${firstName}. What best describes you?` : "What best describes you?")}
                <ChipGroup
                  label="What best describes you?"
                  options={ROLE_OPTIONS.map((value) => ({ value }))}
                  value={roles}
                  onChange={setRoles}
                  multiple={false}
                  onSingleChosen={() => setTimeout(() => goNextRef.current(), 250)}
                />
                {renderFooter()}
              </div>
            )}

            {step === "goals" && (
              <div>
                {renderTitle("What do you want from LinkedIn?", "Pick all that apply.")}
                <ChipGroup label="What do you want from LinkedIn?" options={GOAL_OPTIONS.map((value) => ({ value }))} value={goals} onChange={setGoals} multiple />
                {renderFooter()}
              </div>
            )}

            {step === "audience" && (
              <div>
                {renderTitle("Who do you want to reach?", "Pick all that apply.")}
                <ChipGroup label="Who do you want to reach?" options={AUDIENCE_OPTIONS.map((value) => ({ value }))} value={audience} onChange={setAudience} multiple />
                {renderFooter()}
              </div>
            )}

            {step === "topics" && (
              <div>
                {renderTitle("What do you want to post about?", "We picked a few for you. Change them any time.")}
                <ChipGroup label="What do you want to post about?" options={topicOptions} value={topics} onChange={setTopics} multiple otherLabel="Add your own" />
                {renderFooter()}
              </div>
            )}

            {step === "tone" && (
              <div>
                {renderTitle("How should you sound?", "This shapes how your drafts read. You can add a writing sample later for a closer match.")}
                <ChipGroup
                  label="How should you sound?"
                  options={TONE_OPTIONS.map((t) => ({ value: t.value, hint: t.hint }))}
                  value={tones}
                  onChange={setTones}
                  multiple={false}
                  onSingleChosen={() => setTimeout(() => goNextRef.current(), 250)}
                />
                {renderFooter()}
              </div>
            )}

            {step === "cadence" && (
              <div>
                {renderTitle("How often do you want to post?", `You approve every post before it goes out. Times use your timezone (${timezone}).`)}
                <div role="radiogroup" aria-label="Posts per week" className="grid grid-cols-3 gap-3">
                  {CADENCE_OPTIONS.map((o) => {
                    const selected = postsPerWeek === o.value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => {
                          setPostsPerWeek(o.value);
                          setTimeout(() => goNextRef.current(), 250);
                        }}
                        className={`rounded-2xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 ${
                          selected ? "border-forest bg-forest text-white" : "border-border bg-white hover:border-forest-muted hover:bg-forest-light"
                        }`}
                      >
                        <span className="block text-[15px] font-semibold">{o.label}</span>
                        <span className={`block text-xs mt-0.5 ${selected ? "text-white/80" : "text-ink-secondary"}`}>{o.hint}</span>
                      </button>
                    );
                  })}
                </div>
                {renderFooter({ canSkip: false })}
              </div>
            )}

            {step === "connect" && (
          <div>
            {renderTitle("Connect where you want to work", "Your drafts arrive in Telegram. Review them there, and nothing is posted without your OK.")}

            <div className="space-y-3">
              <div className="rounded-xl border border-forest-muted bg-forest-light/40 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-ink">Telegram</p>
                    <p className="mt-0.5 text-sm text-ink-secondary">
                      Get drafts as images, approve with a tap, and ask for changes by chatting.
                    </p>
                  </div>
                  {telegramConnected && (
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-forest">
                      <Check size={16} aria-hidden="true" /> Connected
                    </span>
                  )}
                </div>
                {!telegramConnected && telegramSkipped && (
                  <p className="mt-3 text-sm text-ink-secondary">
                    Skipped. You can connect Telegram anytime in Integrations.{" "}
                    <button type="button" onClick={() => setTelegramSkipped(false)} className="text-forest font-medium underline-offset-4 hover:underline">
                      Connect now
                    </button>
                  </p>
                )}
                {!telegramConnected && !telegramSkipped && (
                  <div className="mt-4">
                    <div className="flex flex-wrap items-center gap-4">
                      <button type="button" onClick={handleTelegram} disabled={busy !== null} className="btn-primary">
                        {busy === "telegram" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
                        {telegramOpened ? "Open Telegram again" : "Connect Telegram"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setTelegramSkipped(true)}
                        disabled={busy !== null}
                        className="text-sm text-ink-secondary hover:text-ink underline-offset-4 hover:underline"
                      >
                        Skip for now
                      </button>
                    </div>
                    {telegramOpened && (
                      <p className="mt-2 text-xs text-ink-secondary" aria-live="polite">
                        Tap Start in the bot. This page updates when it connects.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-border bg-white p-5">
                <p className="text-sm font-semibold text-ink">LinkedIn</p>
                <p className="mt-0.5 text-sm text-ink-secondary">Needed to publish your approved posts. You can do this later.</p>
                <div className="mt-4">
                  <button type="button" onClick={handleLinkedIn} disabled={busy !== null} className="btn-secondary">
                    {busy === "linkedin" && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                    Connect LinkedIn
                  </button>
                </div>
              </div>
            </div>

            <div className={footerClass}>
              <button type="button" onClick={goBack} disabled={busy !== null} className="btn-secondary">
                <ArrowLeft size={16} aria-hidden="true" />
                Back
              </button>
              <button
                type="button"
                onClick={handleStart}
                disabled={busy !== null}
                className={telegramConnected || telegramSkipped ? "btn-primary" : "btn-secondary"}
              >
                {busy === "finish" && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                {telegramConnected || telegramSkipped ? "Start" : "Go to dashboard"}
              </button>
            </div>
          </div>
        )}
          </div>
        </main>

        <aside className="hidden lg:block" aria-label="Preview of your drafts">
          <PreviewCard name={displayName} role={roles[0]} topic={topics[0]} tone={tones[0]} />
        </aside>
      </div>
    </div>
  );
}

/**
 * A live, honest preview of what the agent will send: the person's own name,
 * role, topic and tone as they tap. The post body is skeleton lines on purpose,
 * since real copy is written later from the profile.
 */
function PreviewCard({ name, role, topic, tone }: { name: string; role?: string; topic?: string; tone?: string }) {
  const shownName = cleanAnswer(name, 40) || "You";
  const initial = shownName.charAt(0).toUpperCase();
  return (
    <div className="sticky top-10">
      <p className="mb-3 text-xs font-medium text-ink-secondary">Preview of your drafts</p>
      <div className="rounded-2xl border border-border bg-white p-5 shadow-card">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-forest text-base font-semibold text-white" aria-hidden="true">
            {initial}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{shownName}</p>
            <p className="truncate text-xs text-ink-secondary">{role || "Your role"}</p>
          </div>
        </div>
        <p className="mt-4 text-[15px] font-semibold leading-snug text-ink transition-opacity" aria-live="polite">
          {topic ? `${topic}: what I'd tell my past self` : "Your next post starts here"}
        </p>
        <div className="mt-3 space-y-2" aria-hidden="true">
          <div className="h-2 w-full rounded-full bg-forest-light" />
          <div className="h-2 w-11/12 rounded-full bg-forest-light" />
          <div className="h-2 w-8/12 rounded-full bg-forest-light" />
        </div>
        {tone && (
          <span className="mt-4 inline-block rounded-full bg-forest-light px-3 py-1 text-xs font-medium text-forest">{tone}</span>
        )}
        <div className="mt-5 grid grid-cols-2 gap-2" aria-hidden="true">
          <span className="rounded-lg bg-forest py-2 text-center text-xs font-semibold text-white">Approve</span>
          <span className="rounded-lg border border-border py-2 text-center text-xs font-semibold text-ink">Request changes</span>
        </div>
      </div>
      <p className="mt-3 text-xs text-ink-secondary">You approve every post. Nothing is published without your OK.</p>
    </div>
  );
}
