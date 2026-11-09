import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireWorkspace, AuthError } from "@/lib/auth/workspace";
import { getVoiceProfile } from "@/lib/db/workspace";
import { Mic2, MessageSquare, ThumbsUp, ThumbsDown, FileText, ArrowRight, AlertCircle, Sparkles } from "lucide-react";

export const metadata: Metadata = {
  title: "Voice Profile — Nunuza",
  robots: { index: false, follow: false },
};

export default async function VoicePage() {
  let workspace;
  try {
    workspace = await requireWorkspace();
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    redirect("/app/onboarding");
  }

  let voice = null;
  let queryError: string | null = null;

  try {
    voice = await getVoiceProfile(workspace.id);
  } catch (err: unknown) {
    queryError = err instanceof Error ? err.message : "Failed to load voice profile.";
  }

  const phrasesUse = Array.isArray(voice?.phrases_use) ? voice.phrases_use : [];
  const phrasesAvoid = Array.isArray(voice?.phrases_avoid) ? voice.phrases_avoid : [];

  return (
    <div className="max-w-4xl mx-auto animate-fade-in pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">Voice Profile</h1>
          <p className="text-sm text-ink-secondary mt-1">
            Tone, rhythm, vocabulary rules, and writing samples for {workspace.name}.
          </p>
        </div>
        <Link href="/app/content" className="btn-primary text-xs flex items-center gap-1.5 self-start">
          <Sparkles size={14} />
          <span>Test in Content Generator</span>
        </Link>
      </div>

      {queryError ? (
        <div className="card p-6 border-error-light bg-error-light/30">
          <div className="flex items-center gap-2 text-error font-semibold text-sm">
            <AlertCircle size={18} />
            <span>Database Error</span>
          </div>
          <p className="text-xs text-ink-secondary mt-1">{queryError}</p>
        </div>
      ) : !voice ? (
        <div className="card p-10 text-center">
          <Mic2 size={32} className="mx-auto text-ink-secondary/50 mb-3" />
          <h3 className="text-base font-semibold text-ink">No Voice Profile Saved</h3>
          <p className="text-sm text-ink-secondary mt-1 max-w-md mx-auto">
            Run the onboarding wizard to define your tone, preferred phrases, and sample writing.
          </p>
          <div className="mt-4">
            <Link href="/app/onboarding" className="btn-secondary text-xs inline-flex items-center gap-1.5">
              <span>Run Onboarding Wizard</span>
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Tone & Sentence Length */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
              <MessageSquare size={16} className="text-forest" />
              <span>Tone & Structure</span>
            </h2>
            <div className="grid sm:grid-cols-2 gap-4 text-xs">
              <div>
                <p className="font-semibold text-ink-secondary">Primary Tone</p>
                <p className="text-ink mt-0.5 text-sm font-medium">{voice.tone || "Direct & Authoritative"}</p>
              </div>
              <div>
                <p className="font-semibold text-ink-secondary">Pacing & Sentence Length</p>
                <p className="text-ink mt-0.5 text-sm font-medium">{voice.sentence_length || "Short to medium sentences"}</p>
              </div>
            </div>
          </div>

          {/* Vocabulary Guidance */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-1.5 text-forest">
                <ThumbsUp size={16} />
                <span>Signature Phrases & Words to Use</span>
              </h2>
              {phrasesUse.length === 0 ? (
                <p className="text-xs text-ink-secondary">No specific phrases specified.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {phrasesUse.map((phrase: string, idx: number) => (
                    <span key={idx} className="badge-active text-xs font-mono">
                      &ldquo;{phrase}&rdquo;
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="card p-5">
              <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-1.5 text-error">
                <ThumbsDown size={16} />
                <span>Buzzwords & Phrases to Avoid</span>
              </h2>
              {phrasesAvoid.length === 0 ? (
                <p className="text-xs text-ink-secondary">No forbidden phrases specified.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {phrasesAvoid.map((phrase: string, idx: number) => (
                    <span key={idx} className="badge-error text-xs font-mono">
                      &ldquo;{phrase}&rdquo;
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Sample Writing */}
          {voice.sample_text && (
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-ink mb-2 flex items-center gap-2">
                <FileText size={16} className="text-ink-secondary" />
                <span>Reference Writing Sample</span>
              </h2>
              <div className="p-4 rounded-lg bg-surface border border-border text-xs text-ink whitespace-pre-wrap font-sans leading-relaxed">
                {voice.sample_text}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
