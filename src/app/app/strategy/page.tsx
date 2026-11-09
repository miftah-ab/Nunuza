import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireWorkspace, AuthError } from "@/lib/auth/workspace";
import { getContentStrategy } from "@/lib/db/workspace";
import { Target, Users, Calendar, ShieldAlert, Sparkles, ArrowRight, AlertCircle } from "lucide-react";

export const metadata: Metadata = {
  title: "Content Strategy — Nunuza",
  robots: { index: false, follow: false },
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function StrategyPage() {
  let workspace;
  try {
    workspace = await requireWorkspace();
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    redirect("/app/onboarding");
  }

  let strategy = null;
  let queryError: string | null = null;

  try {
    strategy = await getContentStrategy(workspace.id);
  } catch (err: unknown) {
    queryError = err instanceof Error ? err.message : "Failed to load content strategy.";
  }

  const audience = (strategy?.audience as Record<string, any>) || {};
  const pillars = Array.isArray(strategy?.pillars) ? strategy.pillars : [];
  const goals = Array.isArray(strategy?.goals) ? strategy.goals : [];
  const exclusions = Array.isArray(strategy?.exclusions) ? strategy.exclusions : [];

  return (
    <div className="max-w-4xl mx-auto animate-fade-in pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">Content Strategy</h1>
          <p className="text-sm text-ink-secondary mt-1">
            Audience targeting, editorial pillars, goals, and cadence for {workspace.name}.
          </p>
        </div>
        <Link href="/app/content" className="btn-primary text-xs flex items-center gap-1.5 self-start">
          <Sparkles size={14} />
          <span>Draft from Strategy</span>
        </Link>
      </div>

      {queryError ? (
        <div className="card p-6 border-error-light bg-error-light/30">
          <div className="flex items-center gap-2 text-error font-semibold text-sm">
            <AlertCircle size={18} />
            <span>Database Error</span>
          </div>
          <p className="text-xs text-ink-secondary mt-1">{queryError}</p>
        </div>
      ) : !strategy ? (
        <div className="card p-10 text-center">
          <Target size={32} className="mx-auto text-ink-secondary/50 mb-3" />
          <h3 className="text-base font-semibold text-ink">No Strategy Defined Yet</h3>
          <p className="text-sm text-ink-secondary mt-1 max-w-md mx-auto">
            Complete the onboarding wizard or save your strategy parameters to guide the AI draft generator.
          </p>
          <div className="mt-4">
            <Link href="/app/onboarding" className="btn-secondary text-xs inline-flex items-center gap-1.5">
              <span>Run Onboarding Wizard</span>
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Target Audience */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
              <Users size={16} className="text-forest" />
              <span>Target Audience & Positioning</span>
            </h2>
            <div className="grid sm:grid-cols-2 gap-4 text-xs">
              <div>
                <p className="font-semibold text-ink-secondary">Target Roles</p>
                <p className="text-ink mt-0.5">{audience.roles || "Not specified"}</p>
              </div>
              <div>
                <p className="font-semibold text-ink-secondary">Key Problems They Face</p>
                <p className="text-ink mt-0.5">{audience.problems || "Not specified"}</p>
              </div>
              <div>
                <p className="font-semibold text-ink-secondary">Desired Outcomes</p>
                <p className="text-ink mt-0.5">{audience.outcomes || "Not specified"}</p>
              </div>
              <div>
                <p className="font-semibold text-ink-secondary">Founder Positioning</p>
                <p className="text-ink mt-0.5">{audience.positioning || "Not specified"}</p>
              </div>
            </div>
          </div>

          {/* Content Pillars */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
              <Target size={16} className="text-forest" />
              <span>Core Content Pillars ({pillars.length})</span>
            </h2>
            {pillars.length === 0 ? (
              <p className="text-xs text-ink-secondary">No pillars configured.</p>
            ) : (
              <div className="grid sm:grid-cols-3 gap-3">
                {pillars.map((pillar: any, idx: number) => {
                  const title = typeof pillar === "string" ? pillar : pillar?.name || `Pillar ${idx + 1}`;
                  return (
                    <div key={idx} className="p-3 rounded-lg bg-surface border border-border text-xs">
                      <p className="font-semibold text-ink">{title}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Posting Cadence & Schedule */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
              <Calendar size={16} className="text-forest" />
              <span>Cadence & Timing</span>
            </h2>
            <div className="grid sm:grid-cols-3 gap-4 text-xs">
              <div>
                <p className="font-semibold text-ink-secondary">Posts per Week</p>
                <p className="text-ink mt-0.5 font-bold text-sm">{strategy.cadence_per_week}</p>
              </div>
              <div>
                <p className="font-semibold text-ink-secondary">Preferred Days</p>
                <p className="text-ink mt-0.5">
                  {strategy.preferred_days && strategy.preferred_days.length > 0
                    ? strategy.preferred_days.map((d: number) => DAY_NAMES[d] || d).join(", ")
                    : "Weekdays"}
                </p>
              </div>
              <div>
                <p className="font-semibold text-ink-secondary">Time Zone</p>
                <p className="text-ink mt-0.5">{strategy.timezone || "UTC"}</p>
              </div>
            </div>
          </div>

          {/* Goals & Exclusions */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-ink mb-2">Primary Goals</h2>
              {goals.length === 0 ? (
                <p className="text-xs text-ink-secondary">No specific goals set.</p>
              ) : (
                <ul className="list-disc list-inside text-xs text-ink space-y-1">
                  {goals.map((g: string, i: number) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card p-5">
              <h2 className="text-sm font-semibold text-ink mb-2 flex items-center gap-1.5">
                <ShieldAlert size={14} className="text-warning" />
                <span>Exclusions & Forbidden Topics</span>
              </h2>
              {exclusions.length === 0 ? (
                <p className="text-xs text-ink-secondary">No topic exclusions set.</p>
              ) : (
                <ul className="list-disc list-inside text-xs text-ink space-y-1">
                  {exclusions.map((e: string, i: number) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
