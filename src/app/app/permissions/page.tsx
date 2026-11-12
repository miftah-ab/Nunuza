import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireWorkspace, AuthError } from "@/lib/auth/workspace";
import { PermissionsClient } from "./PermissionsClient";

export const metadata: Metadata = {
  title: "Publishing & Permissions — Nunuza",
  robots: { index: false },
};

export default async function PermissionsPage() {
  let workspace;
  try {
    workspace = await requireWorkspace();
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    redirect("/app/onboarding");
  }

  return (
    <div className="max-w-3xl mx-auto animate-fade-in py-2">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">Publishing &amp; Permissions</h1>
        <p className="text-sm text-ink-secondary mt-1">
          Choose when Nunuza can work automatically, pause it at any time, and review the limits it follows.
        </p>
      </div>

      <PermissionsClient initialWorkspace={workspace} />
    </div>
  );
}
