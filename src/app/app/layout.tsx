/**
 * Authenticated app layout — wraps all /app/* routes.
 *
 * Verifies server-side that the user is authenticated.
 * Unauthenticated requests are caught by middleware first,
 * but this is an additional server-side check (defense in depth).
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { NotificationPrompt } from "@/components/notifications/NotificationPrompt";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import type { Workspace } from "@/types/database";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  // Server-side auth check
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Load workspace for sidebar display
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("*")
    .eq("owner_user_id", user.id)
    .single();

  // If user is in onboarding wizard (setup_required), render full-page onboarding
  if (!workspace || workspace.state === "setup_required") {
    return (
      <div className="min-h-screen bg-offwhite">
        <main id="main-content" className="p-4 sm:p-6 lg:p-8">
          <div className="mb-5 flex justify-end"><NotificationBell /></div>
          <NotificationPrompt />
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-offwhite">
      <AppSidebar workspace={workspace as Workspace | null} />
      <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
        <main id="main-content" className="flex-1 p-5 sm:p-6 lg:p-8 max-w-[1400px]">
          <div className="mb-5 flex justify-end"><NotificationBell /></div>
          <NotificationPrompt />
          {children}
        </main>
      </div>
    </div>
  );
}

