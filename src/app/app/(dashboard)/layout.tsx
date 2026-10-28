/**
 * Authenticated app layout — wraps all /app/* routes.
 *
 * Verifies server-side that the user is authenticated.
 * Unauthenticated requests are caught by middleware first,
 * but this is an additional server-side check (defense in depth).
 *
 * Does NOT check entitlement — each page/route does that independently.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppSidebar } from "@/components/layout/AppSidebar";
import type { Workspace } from "@/types/database";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  // Server-side auth check — middleware handles redirect for most cases,
  // but this guard protects against middleware bypass.
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

  return (
    <div className="flex min-h-screen bg-offwhite">
      <AppSidebar workspace={workspace as Workspace | null} />
      <div className="flex-1 flex flex-col min-w-0">
        <main id="main-content" className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
