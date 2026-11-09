import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspace, AuthError } from "@/lib/auth/workspace";
import { SettingsClient } from "./SettingsClient";

export const metadata: Metadata = {
  title: "Settings — Nunuza",
  robots: { index: false },
};

export default async function SettingsPage() {
  let workspace;
  try {
    workspace = await requireWorkspace();
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    redirect("/app/onboarding");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return (
    <div className="max-w-2xl mx-auto animate-fade-in py-2">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">Workspace &amp; Account Settings</h1>
        <p className="text-sm text-ink-secondary mt-1">
          Manage your personal profile, workspace preferences, and content export.
        </p>
      </div>

      <SettingsClient
        userEmail={user.email || ""}
        initialProfile={profile}
        initialWorkspace={workspace}
      />
    </div>
  );
}
