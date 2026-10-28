import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
export const metadata: Metadata = { title: "Permissions", robots: { index: false } };
export default async function PermissionsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <h1 className="text-2xl font-bold text-ink mb-1">Permissions</h1>
      <p className="text-sm text-ink-secondary mb-6">Operating mode, posting limits, and autonomy settings.</p>
      <div className="card p-5 mb-4"><p className="text-sm font-semibold text-ink mb-1">Operating mode</p><p className="text-sm text-ink-secondary">Approval Required — all drafts require your explicit approval before any action. This is the only mode available in the draft-only preview.</p></div>
      <div className="card p-5 opacity-60"><p className="text-sm font-semibold text-ink mb-1">Autopilot</p><p className="text-xs text-ink-secondary">Not available during the draft-only preview or LinkedIn publishing beta. Available only for paid workspaces after all Autopilot release gates pass.</p></div>
    </div>
  );
}
