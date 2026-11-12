"use client";
import { userFacingError } from "@/lib/ui/error-message";

import { useState } from "react";
import type { ContentStrategy } from "@/types/database";
import { AlertCircle, CheckCircle2, Loader2, Save } from "lucide-react";

interface StrategyEditorProps {
  strategy: ContentStrategy;
  workspaceName: string;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const toLines = (items: unknown): string =>
  Array.isArray(items) ? items.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object" && "name" in item) return String((item as { name: unknown }).name);
    return String(item);
  }).join("\n") : "";
const splitLines = (value: string): string[] =>
  value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);

export function StrategyEditor({ strategy, workspaceName }: StrategyEditorProps) {
  const audience = (strategy.audience ?? {}) as Record<string, unknown>;
  const [form, setForm] = useState({
    audienceRoles: String(audience.roles ?? ""),
    audienceProblems: String(audience.problems ?? ""),
    audienceOutcomes: String(audience.outcomes ?? ""),
    founderRole: String(audience.founder_role ?? ""),
    company: String(audience.company ?? ""),
    positioning: String(audience.positioning ?? ""),
    linkedinUrl: String(audience.linkedin_url ?? ""),
    goals: toLines(strategy.goals),
    pillars: toLines(strategy.pillars),
    exclusions: toLines(strategy.exclusions),
    ctaPreferences: toLines(strategy.cta_preferences),
    cadencePerWeek: String(strategy.cadence_per_week ?? 3),
    preferredDays: strategy.preferred_days ?? [],
    preferredTime: strategy.preferred_time?.slice(0, 5) ?? "",
    timezone: strategy.timezone || "UTC",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [version, setVersion] = useState(strategy.version);
  const [updatedAt, setUpdatedAt] = useState(strategy.updated_at);

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSavedMessage(null);
  };

  const toggleDay = (day: number) => {
    const next = form.preferredDays.includes(day)
      ? form.preferredDays.filter((value) => value !== day)
      : [...form.preferredDays, day].sort((a, b) => a - b);
    update("preferredDays", next);
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setSavedMessage(null);

    try {
      const response = await fetch("/api/strategy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          cadencePerWeek: Number(form.cadencePerWeek),
          goals: splitLines(form.goals),
          pillars: splitLines(form.pillars),
          exclusions: splitLines(form.exclusions),
          ctaPreferences: splitLines(form.ctaPreferences),
          preferredTime: form.preferredTime || null,
        }),
      });
      const json = await response.json() as { error?: string; data?: { strategy?: ContentStrategy } };
      if (!response.ok || json.error) {
        throw new Error(json.error || "Could not save your content strategy.");
      }

      const saved = json.data?.strategy as ContentStrategy | undefined;
      if (!saved) throw new Error("The server did not return the saved strategy.");

      setVersion(saved.version);
      setUpdatedAt(saved.updated_at);
      setSavedMessage("Strategy saved. Future AI drafts and plans will use these settings.");
    } catch (err) {
      setError(userFacingError(err, "We couldn’t save your content strategy. Please try again."));
    } finally {
      setIsSaving(false);
    }
  };

  const fieldClass = "input-field";
  const labelClass = "block text-sm font-medium text-ink mb-1.5";
  const helpClass = "text-xs text-ink-secondary mt-1";

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Content Strategy</h1>
          <p className="text-sm text-ink-secondary mt-1">
            Manage the audience, positioning, editorial direction, and publishing rhythm for {workspaceName}.
          </p>
        </div>
        <div className="text-xs text-ink-secondary">
          Version {version}{updatedAt ? ` · Updated ${updatedAt.slice(0, 10)}` : ""}
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-error-light bg-error-light/30 p-3 text-sm text-error flex items-start gap-2">
          <AlertCircle size={17} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {savedMessage && (
        <div role="status" className="rounded-lg border border-forest-muted bg-forest-light/40 p-3 text-sm text-ink flex items-start gap-2">
          <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-forest" />
          <span>{savedMessage}</span>
        </div>
      )}

      <section className="card p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Audience & positioning</h2>
          <p className={helpClass}>Be specific about who you want to reach and why they should listen.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass} htmlFor="strategy-audience-roles">Target roles and industries</label>
            <textarea id="strategy-audience-roles" rows={2} maxLength={500} className={fieldClass} value={form.audienceRoles} onChange={(e) => update("audienceRoles", e.target.value)} placeholder="B2B founders, product leaders..." />
          </div>
          <div>
            <label className={labelClass} htmlFor="strategy-audience-problems">Audience problems</label>
            <textarea id="strategy-audience-problems" rows={2} maxLength={1200} className={fieldClass} value={form.audienceProblems} onChange={(e) => update("audienceProblems", e.target.value)} placeholder="What challenges do they face?" />
          </div>
          <div>
            <label className={labelClass} htmlFor="strategy-audience-outcomes">Desired audience outcomes</label>
            <textarea id="strategy-audience-outcomes" rows={2} maxLength={1200} className={fieldClass} value={form.audienceOutcomes} onChange={(e) => update("audienceOutcomes", e.target.value)} placeholder="What should your content help them achieve?" />
          </div>
          <div>
            <label className={labelClass} htmlFor="strategy-positioning">Professional positioning</label>
            <textarea id="strategy-positioning" rows={2} maxLength={1200} className={fieldClass} value={form.positioning} onChange={(e) => update("positioning", e.target.value)} placeholder="The perspective or expertise you bring..." />
          </div>
          <div>
            <label className={labelClass} htmlFor="strategy-founder-role">Your role</label>
            <input id="strategy-founder-role" maxLength={160} className={fieldClass} value={form.founderRole} onChange={(e) => update("founderRole", e.target.value)} placeholder="Founder, engineer, consultant..." />
          </div>
          <div>
            <label className={labelClass} htmlFor="strategy-company">Company or venture</label>
            <input id="strategy-company" maxLength={160} className={fieldClass} value={form.company} onChange={(e) => update("company", e.target.value)} placeholder="Company name" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="strategy-linkedin">LinkedIn profile URL</label>
            <input id="strategy-linkedin" type="url" maxLength={300} className={fieldClass} value={form.linkedinUrl} onChange={(e) => update("linkedinUrl", e.target.value)} placeholder="https://www.linkedin.com/in/..." />
          </div>
        </div>
      </section>

      <section className="card p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Editorial direction</h2>
          <p className={helpClass}>Use one item per line. These settings guide future draft and plan generation.</p>
        </div>
        <div>
          <label className={labelClass} htmlFor="strategy-pillars">Content pillars</label>
          <textarea id="strategy-pillars" rows={5} maxLength={1800} className={fieldClass} value={form.pillars} onChange={(e) => update("pillars", e.target.value)} placeholder={"Building in public\nProduct lessons\nIndustry insights"} />
        </div>
        <div>
          <label className={labelClass} htmlFor="strategy-goals">Business and content goals</label>
          <textarea id="strategy-goals" rows={3} maxLength={1200} className={fieldClass} value={form.goals} onChange={(e) => update("goals", e.target.value)} placeholder={"Generate qualified leads\nBuild authority with SaaS founders"} />
        </div>
        <div>
          <label className={labelClass} htmlFor="strategy-exclusions">Topics and themes to avoid</label>
          <textarea id="strategy-exclusions" rows={3} maxLength={1600} className={fieldClass} value={form.exclusions} onChange={(e) => update("exclusions", e.target.value)} placeholder={"Political commentary\nCompetitor attacks"} />
          <p className={helpClass}>Nunuza checks these phrases against requested topics and generated content, and instructs the AI to avoid related themes.</p>
        </div>
        <div>
          <label className={labelClass} htmlFor="strategy-ctas">Preferred calls to action</label>
          <textarea id="strategy-ctas" rows={2} maxLength={1000} className={fieldClass} value={form.ctaPreferences} onChange={(e) => update("ctaPreferences", e.target.value)} placeholder={"Invite a thoughtful reply\nAsk readers to share an experience"} />
        </div>
      </section>

      <section className="card p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Publishing cadence & timing</h2>
          <p className={helpClass}>These preferences guide content planning. They do not schedule or publish posts by themselves.</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className={labelClass} htmlFor="strategy-cadence">Posts per week</label>
            <select id="strategy-cadence" className={fieldClass} value={form.cadencePerWeek} onChange={(e) => update("cadencePerWeek", e.target.value)}>
              {[1, 2, 3, 4, 5, 6, 7].map((count) => <option key={count} value={count}>{count} per week</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="strategy-time">Preferred posting time</label>
            <input id="strategy-time" type="time" className={fieldClass} value={form.preferredTime} onChange={(e) => update("preferredTime", e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="strategy-timezone">Time zone (IANA)</label>
            <input id="strategy-timezone" maxLength={80} className={fieldClass} value={form.timezone} onChange={(e) => update("timezone", e.target.value)} placeholder="America/New_York" />
          </div>
        </div>
        <div>
          <p className={labelClass}>Preferred posting days</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {DAY_NAMES.map((day, index) => (
              <label key={day} className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                <input type="checkbox" checked={form.preferredDays.includes(index)} onChange={() => toggleDay(index)} className="accent-forest" />
                {day}
              </label>
            ))}
          </div>
          <p className={helpClass}>Leave all days unchecked if you have no preferred days.</p>
        </div>
      </section>

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-xs text-ink-secondary">Changes apply to future AI drafts and plans. Existing posts and scheduled jobs are not rewritten.</p>
        <button type="submit" disabled={isSaving} className="btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-60">
          {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {isSaving ? "Saving..." : "Save strategy"}
        </button>
      </div>
    </form>
  );
}
