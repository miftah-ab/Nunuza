"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";

interface TelegramWebApp {
  initData: string;
  ready(): void;
  expand(): void;
  close(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
}
declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

interface DraftData {
  id: string;
  title: string;
  text: string;
  actionable: boolean;
  status: string;
  name: string;
  headline: string | null;
  avatarUrl: string | null;
}

type Outcome = { kind: "scheduled"; when: string } | { kind: "approved" } | { kind: "rejected" };

/**
 * The whole draft, inside Telegram, as it will read on LinkedIn. The chat image
 * can only fit so much; this is where a long post is read in full. Approving a
 * post is enabled only once the end of it has been reached.
 */
export function ReviewClient({ postId }: { postId: string }) {
  const [initData, setInitData] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg?.initData) {
      setError("Open this page from the Read full post button in your Nunuza Telegram bot.");
      return;
    }
    tg.ready();
    tg.expand();
    try {
      tg.setHeaderColor?.("#ffffff");
      tg.setBackgroundColor?.("#ffffff");
    } catch {
      // Older Telegram versions do not support colors.
    }
    setInitData(tg.initData);
  }, []);

  useEffect(() => {
    if (!initData) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/telegram/webapp/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData, postId }),
        });
        const json = await response.json();
        if (cancelled) return;
        if (!response.ok || !json.data) setError(json.error || "We couldn’t load this draft.");
        else setDraft(json.data as DraftData);
      } catch {
        if (!cancelled) setError("We couldn’t load this draft. Check your connection and try again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initData, postId]);

  // The end-of-post marker scrolling into view unlocks Approve. A short post
  // that already fits the screen unlocks immediately.
  useEffect(() => {
    const node = endRef.current;
    if (!draft || !node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setReachedEnd(true);
    }, { threshold: 1 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [draft]);

  const act = useCallback(
    async (action: "approve" | "reject") => {
      if (!initData) return;
      setBusy(action);
      setError(null);
      try {
        const response = await fetch("/api/telegram/webapp/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData, postId, action }),
        });
        const json = await response.json();
        if (!response.ok || !json.data) {
          setError(json.error || "That did not go through. Please try again.");
          setBusy(null);
          return;
        }
        const data = json.data as { outcome: string; when?: string };
        setOutcome(
          data.outcome === "rejected" ? { kind: "rejected" } : data.outcome === "scheduled" && data.when ? { kind: "scheduled", when: data.when } : { kind: "approved" }
        );
      } catch {
        setError("That did not go through. Check your connection and try again.");
      }
      setBusy(null);
    },
    [initData, postId]
  );

  const close = () => window.Telegram?.WebApp?.close();

  if (outcome) {
    return (
      <main className="min-h-screen bg-white flex flex-col items-center justify-center px-6 text-center">
        <span className={`flex h-14 w-14 items-center justify-center rounded-full text-white ${outcome.kind === "rejected" ? "bg-ink-secondary" : "bg-forest"}`} aria-hidden="true">
          <Check size={28} strokeWidth={3} />
        </span>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-ink">
          {outcome.kind === "rejected" ? "Draft rejected" : "Approved"}
        </h1>
        <p className="mt-2 max-w-xs text-[15px] text-ink-secondary" role="status">
          {outcome.kind === "scheduled"
            ? `It will be published on ${outcome.when}. You can cancel the schedule in the chat.`
            : outcome.kind === "approved"
              ? "It is approved. Schedule it from your dashboard."
              : "Nothing was published."}
        </p>
        <button type="button" onClick={close} className="btn-primary mt-8">Back to Telegram</button>
      </main>
    );
  }

  if (error && !draft) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center px-6 text-center">
        <p className="max-w-xs text-[15px] text-ink-secondary" role="alert">{error}</p>
      </main>
    );
  }

  if (!draft) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center" aria-busy="true">
        <Loader2 className="animate-spin text-forest" size={28} aria-label="Loading your draft" />
      </main>
    );
  }

  const initial = (draft.name.trim().charAt(0) || "Y").toUpperCase();
  const canApprove = draft.actionable && reachedEnd && busy === null;

  return (
    <main className="min-h-screen bg-white pb-40">
      <article className="mx-auto max-w-xl px-5 pt-6">
        <header className="flex items-start gap-3">
          {draft.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={draft.avatarUrl} alt="" width={48} height={48} className="h-12 w-12 rounded-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#a8b3bd] text-lg font-semibold text-white" aria-hidden="true">{initial}</span>
          )}
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-ink">{draft.name}</p>
            {draft.headline && <p className="truncate text-sm text-ink-secondary">{draft.headline}</p>}
            <p className="text-sm text-ink-secondary">Now · 🌐</p>
          </div>
        </header>

        <div className="mt-4 whitespace-pre-wrap break-words text-[17px] leading-[1.5] text-ink">{draft.text}</div>
        <div ref={endRef} aria-hidden="true" className="h-px" />
      </article>

      <footer className="fixed inset-x-0 bottom-0 border-t border-border bg-white/95 px-5 pb-5 pt-3 backdrop-blur">
        <div className="mx-auto max-w-xl">
          {error && <p className="mb-2 text-sm text-red-700" role="alert">{error}</p>}
          {!draft.actionable ? (
            <p className="text-center text-sm text-ink-secondary" role="status">This draft was already decided.</p>
          ) : (
            <>
              {!reachedEnd && <p className="mb-2 text-center text-xs text-ink-secondary" role="status">Scroll to the end to approve.</p>}
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <button type="button" onClick={() => act("approve")} disabled={!canApprove} className="btn-primary justify-center disabled:opacity-40">
                  {busy === "approve" && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                  Approve and publish
                </button>
                <button
                  type="button"
                  onClick={() => (confirmReject ? act("reject") : setConfirmReject(true))}
                  onBlur={() => setConfirmReject(false)}
                  disabled={busy !== null}
                  className="btn-secondary"
                >
                  {busy === "reject" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : confirmReject ? "Tap again to reject" : "Reject"}
                </button>
              </div>
            </>
          )}
        </div>
      </footer>
    </main>
  );
}
