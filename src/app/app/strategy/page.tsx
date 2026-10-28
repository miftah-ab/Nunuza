import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
export const metadata: Metadata = { title: "Strategy", robots: { index: false } };
export default async function StrategyPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      <h1 className="text-2xl font-bold text-ink mb-1">Strategy</h1>
      <p className="text-sm text-ink-secondary mb-6">Content pillars, audience, goals, cadence. Builds in Phase 3.</p>
      <div className="card p-8 text-center text-ink-secondary text-sm">Strategy editor builds in Phase 3.</div>
    </div>
  );
}
