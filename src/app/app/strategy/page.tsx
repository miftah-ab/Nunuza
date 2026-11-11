import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireWorkspace, AuthError } from "@/lib/auth/workspace";
import { getContentStrategy } from "@/lib/db/workspace";
import { StrategyEditor } from "@/components/strategy/StrategyEditor";
import { AlertCircle, ArrowRight, Target } from "lucide-react";

export const metadata: Metadata = {
  title: "Content Strategy — Nunuza",
  robots: { index: false, follow: false },
};

export default async function StrategyPage() {
  let workspace;
  try {
    workspace = await requireWorkspace();
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    redirect("/app/onboarding");
  }

  let strategy = null;
  let queryFailed = false;
  try {
    strategy = await getContentStrategy(workspace.id);
  } catch {
    queryFailed = true;
  }

  return (
    <div className="max-w-4xl mx-auto animate-fade-in pb-12">
      {queryFailed ? (
        <div className="card p-6 border-error-light bg-error-light/30">
          <div className="flex items-center gap-2 text-error font-semibold text-sm">
            <AlertCircle size={18} />
            <span>Could not load content strategy</span>
          </div>
          <p className="text-xs text-ink-secondary mt-1">
            Your saved settings have not been changed. Refresh the page or try again later.
          </p>
        </div>
      ) : !strategy ? (
        <div className="card p-10 text-center">
          <Target size={32} className="mx-auto text-ink-secondary/50 mb-3" />
          <h1 className="text-xl font-semibold text-ink">No strategy defined yet</h1>
          <p className="text-sm text-ink-secondary mt-2 max-w-md mx-auto">
            Complete workspace onboarding before managing your audience, content pillars, and publishing preferences.
          </p>
          <Link href="/app/onboarding" className="btn-primary text-xs inline-flex items-center gap-1.5 mt-5">
            Complete onboarding <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <>
          <StrategyEditor strategy={strategy} workspaceName={workspace.name} />
          <div className="mt-6 rounded-lg border border-border bg-surface p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ink">Use this strategy in your workflow</p>
              <p className="text-xs text-ink-secondary mt-1">
                Future AI drafts and content plans use your saved audience, pillars, goals, exclusions, and calls to action.
              </p>
            </div>
            <Link href="/app/content" className="btn-secondary text-xs whitespace-nowrap">
              Open Content
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
