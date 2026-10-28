import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
export const metadata: Metadata = { title: "Settings", robots: { index: false } };
export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      <h1 className="text-2xl font-bold text-ink mb-6">Settings</h1>
      <div className="card p-6 space-y-4">
        <div><p className="text-xs text-ink-secondary font-medium uppercase tracking-widest mb-1">Email</p><p className="text-sm text-ink">{user.email}</p></div>
        <div><p className="text-xs text-ink-secondary font-medium uppercase tracking-widest mb-1">Display name</p><p className="text-sm text-ink">{profile?.display_name ?? "—"}</p></div>
        <div><p className="text-xs text-ink-secondary font-medium uppercase tracking-widest mb-1">Time zone</p><p className="text-sm text-ink">{profile?.timezone ?? "UTC"}</p></div>
      </div>
      <div className="mt-6 card p-5 border-error-light bg-error-light/30">
        <p className="text-sm font-semibold text-ink mb-1">Delete account</p>
        <p className="text-xs text-ink-secondary mb-3">Permanently removes your workspace and all data. This cannot be undone. Export your drafts first.</p>
        <button disabled className="btn-secondary text-sm opacity-60 cursor-not-allowed">Delete account — builds in Phase 3</button>
      </div>
    </div>
  );
}
