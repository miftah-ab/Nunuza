import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
export const metadata: Metadata = { title: "Activity", robots: { index: false } };
export default async function ActivityPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      <h1 className="text-2xl font-bold text-ink mb-1">Activity</h1>
      <p className="text-sm text-ink-secondary mb-6">Agent job history. Full job log builds in Phase 5.</p>
      <div className="card p-8 text-center text-ink-secondary text-sm">No agent jobs yet. Background agent builds in Phase 5.</div>
    </div>
  );
}
