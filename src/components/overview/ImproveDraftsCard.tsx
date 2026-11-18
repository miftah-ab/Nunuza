"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PenLine, X } from "lucide-react";

const STORAGE_KEY = "nunuza:improve-drafts-dismissed";

/**
 * Shown after a person has seen their first draft and has not yet given the
 * agent a writing sample. A sample is the biggest single improvement to how
 * drafts sound, so it is offered when its value is visible, not during setup.
 * Dismissal is a per-browser convenience; the card also disappears for good
 * once a sample exists.
 */
export function ImproveDraftsCard() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) !== "1") setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Storage can be blocked; the card simply comes back next visit.
    }
  };

  return (
    <section
      aria-label="Improve your drafts"
      className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-2xl border border-forest-muted bg-forest-light/40 p-5 pr-12"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-forest text-white" aria-hidden="true">
          <PenLine size={16} />
        </span>
        <div>
          <p className="text-sm font-semibold text-ink">Make your drafts sound more like you</p>
          <p className="mt-0.5 text-sm text-ink-secondary">
            Paste one post you are proud of. Your agent learns your style, not your words. It takes about a minute.
          </p>
        </div>
      </div>
      <Link href="/app/voice" className="btn-primary shrink-0 self-start sm:self-auto">
        Add a writing sample
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-3 top-3 rounded-full p-1.5 text-ink-secondary hover:bg-white hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </section>
  );
}
