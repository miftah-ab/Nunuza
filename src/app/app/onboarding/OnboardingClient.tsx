"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
const STEPS: StepKey[] = ["name", "role", "goals", "audience", "topics", "tone", "cadence", "connect"];

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
    `inline-flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 ${
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
  const [step, setStep] = useState<StepKey>("name");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"finish" | "linkedin" | "telegram" | null>(null);

  const [displayName, setDisplayName] = useState(initialDisplayName || "");
  const [roles, setRoles] = useState<string[]>([]);
  const [goals, setGoals] = useState<string[]>([]);
  const [audience, setAudience] = useState<string[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [tones, setTones] = useState<string[]>([]);
  const [postsPerWeek, setPostsPerWeek] = useState(3);
  const [timezone, setTimezone] = useState(initialTimezone && initialTimezone !== "UTC" ? initialTimezone : "UTC");
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [telegramOpened, setTelegramOpened] = useState(false);
  const topicsSeeded = useRef(false);

  const index = STEPS.indexOf(step);

  // Detect the timezone instead of asking for it.
  useEffect(() => {
    if (initialTimezone && initialTimezone !== "UTC") return;
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) setTimezone(detected);
    } catch {
      // keep the default
    }
  }, [initialTimezone]);

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
  goNextRef.current = goNext;

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
      router.push("/app/overview");
      router.refresh();
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

  const topicOptions = (() => {
    const base = suggestTopics(roles);
    return base.map((value) => ({ value }));
  })();

  const questionCount = STEPS.length - 1;
  const progress = Math.min(index, questionCount) / questionCount;

  const renderFooter = ({ canSkip = true, nextLabel = "Continue" }: { canSkip?: boolean; nextLabel?: string } = {}) => (
    <div className="mt-10 flex items-center justify-between">
      <button type="button" onClick={goBack} className="btn-secondary" aria-label="Back">
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
          {nextLabel}
        </button>
      </div>
    </div>
  );

  const renderTitle = (children: React.ReactNode, hint?: string) => (
    <div className="mb-6">
      <h1 className="text-2xl font-bold text-ink">{children}</h1>
      {hint && <p className="mt-1.5 text-sm text-ink-secondary">{hint}</p>}
    </div>
  );

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="flex items-center justify-between h-16 px-6 border-b border-border bg-white">
        <Logo height={24} asLink={false} />
        {step !== "connect" && <span className="text-xs text-ink-secondary">{index + 1} of {questionCount}</span>}
      </header>
      <div
        className="h-1 bg-forest-light"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-label="Setup progress"
      >
        <div className="h-full bg-forest transition-all duration-300" style={{ width: `${Math.max(progress, 0.04) * 100}%` }} />
      </div>

      <main id="main-content" className="flex-1 w-full max-w-xl mx-auto px-6 py-10 sm:py-16">
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2.5" role="alert">
            <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <p>{error}</p>
          </div>
        )}

        {step === "name" && (
          <div>
            {renderTitle("Welcome to Nunuza", "A few taps and your agent starts working. You can change any answer later.")}
            <label htmlFor="display-name" className="block text-sm font-medium text-ink mb-1.5">
              What should we call you?
            </label>
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
              autoComplete="name"
              className="input-field w-full"
            />
            <div className="mt-10 flex justify-end">
              <button type="button" onClick={goNext} className="btn-primary">
                Get started
              </button>
            </div>
          </div>
        )}

        {step === "role" && (
          <div>
            {renderTitle("What best describes you?")}
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
            <ChipGroup
              label="What do you want to post about?"
              options={topicOptions}
              value={topics}
              onChange={setTopics}
              multiple
              otherLabel="Add your own"
            />
            {renderFooter()}
          </div>
        )}

        {step === "tone" && (
          <div>
            {renderTitle("How should you sound?", "This shapes how your drafts sound. You can add a writing sample later for a closer match.")}
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
                    className={`rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 ${
                      selected ? "border-forest bg-forest text-white" : "border-border bg-white hover:border-forest-muted hover:bg-forest-light"
                    }`}
                  >
                    <span className="block text-sm font-semibold">{o.label}</span>
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
                {!telegramConnected && (
                  <div className="mt-4">
                    <button type="button" onClick={handleTelegram} disabled={busy !== null} className="btn-primary">
                      {busy === "telegram" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
                      {telegramOpened ? "Open Telegram again" : "Connect Telegram"}
                    </button>
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

            <div className="mt-10 flex items-center justify-between">
              <button type="button" onClick={goBack} disabled={busy !== null} className="btn-secondary">
                <ArrowLeft size={16} aria-hidden="true" />
                Back
              </button>
              <button
                type="button"
                onClick={handleStart}
                disabled={busy !== null}
                className={telegramConnected ? "btn-primary" : "btn-secondary"}
              >
                {busy === "finish" && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                {telegramConnected ? "Start" : "Skip for now"}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
