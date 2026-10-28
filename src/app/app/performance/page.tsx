import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
export const metadata: Metadata = { title: "Performance", robots: { index: false } };
export default async function PerformancePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return (
    <div className="max-w-4xl mx-auto animate-fade-in">
      <h1 className="text-2xl font-bold text-ink mb-1">Performance</h1>
      <p className="text-sm text-ink-secondary mb-6">Publishing history and available LinkedIn metrics.</p>
      <div className="card p-8 text-center text-ink-secondary text-sm">Performance data available after LinkedIn publishing access is verified. Analytics scopes (r_member_social) are not available in v1.</div>
    </div>
  );
}
