import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingClient } from "./OnboardingClient";

export const metadata: Metadata = {
  title: "Get started — Nunuza",
  robots: { index: false, follow: false },
};

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // If already set up, redirect to overview dashboard
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("state, entitlement_type")
    .eq("owner_user_id", user.id)
    .single();

  if (workspace && workspace.state !== "setup_required") {
    redirect("/app/overview");
  }

  // Preload profile info if existing
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, timezone")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <OnboardingClient
      initialDisplayName={profile?.display_name}
      initialTimezone={profile?.timezone}
    />
  );
}
