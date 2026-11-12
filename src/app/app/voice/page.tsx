import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireWorkspace, AuthError } from "@/lib/auth/workspace";
import { getVoiceProfile } from "@/lib/db/workspace";
import { AlertCircle, Mic2 } from "lucide-react";
import { VoiceEditor } from "@/components/voice/VoiceEditor";

export const metadata: Metadata = {
  title: "Voice Profile — Nunuza",
  robots: { index: false, follow: false },
};

export default async function VoicePage() {
  let workspace;
  try {
    workspace = await requireWorkspace();
  } catch (error) {
    if (error instanceof AuthError) redirect("/login");
    redirect("/app/onboarding");
  }

  let voice = null;
  let queryFailed = false;
  try {
    voice = await getVoiceProfile(workspace.id);
  } catch {
    queryFailed = true;
  }

  return (
    <div className="mx-auto max-w-4xl animate-fade-in pb-12">
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <Mic2 size={20} className="text-forest" />
          <h1 className="text-2xl font-bold text-ink">Voice Profile</h1>
        </div>
        <p className="mt-1 text-sm text-ink-secondary">
          Define how Nunuza writes for {workspace.name}. These preferences guide future drafts and content plans.
        </p>
      </div>

      {queryFailed ? (
        <div role="alert" className="card border-error-light bg-error-light/30 p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-error">
            <AlertCircle size={18} />
            Could not load your Voice profile
          </div>
          <p className="mt-1 text-xs text-ink-secondary">Refresh the page and try again. Your saved settings have not been changed.</p>
        </div>
      ) : (
        <>
          {!voice && (
            <div className="mb-5 rounded-lg border border-border bg-surface p-4">
              <p className="text-sm font-medium text-ink">Create your writing profile</p>
              <p className="mt-1 text-xs text-ink-secondary">Set the fields below and save. You can change them at any time.</p>
            </div>
          )}
          <VoiceEditor initialProfile={voice} />
        </>
      )}
    </div>
  );
}
