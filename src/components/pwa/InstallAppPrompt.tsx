"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, Share, X } from "lucide-react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const subscribeToNothing = () => () => {};
const getIsIosDevice = () => {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const isIosDevice = /iPad|iPhone|iPod/.test(ua) ||
    (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in window.navigator && Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone));
  return isIosDevice && !isStandalone;
};
const getServerIosSnapshot = () => false;

export function InstallAppPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const ios = useSyncExternalStore(subscribeToNothing, getIsIosDevice, getServerIosSnapshot);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      setShowIosHelp(false);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!installEvent && !ios) return null;

  async function install() {
    if (!installEvent) {
      setShowIosHelp(true);
      return;
    }
    setBusy(true);
    try {
      await installEvent.prompt();
      await installEvent.userChoice;
      setInstallEvent(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void install()}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg border border-forest/20 bg-white px-3 py-2 text-sm font-medium text-forest transition hover:bg-forest-light disabled:opacity-60"
      >
        <Download size={16} aria-hidden="true" />
        Install app
      </button>
      {showIosHelp && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-ink/40 p-4 sm:items-center" role="presentation" onClick={() => setShowIosHelp(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 id="ios-install-title" className="text-lg font-semibold text-ink">Install Nunuza</h2>
              <button type="button" aria-label="Close" onClick={() => setShowIosHelp(false)} className="rounded-lg p-2 text-ink-secondary hover:bg-surface">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm leading-6 text-ink-secondary">
              In Safari, tap <Share className="mx-1 inline-block" size={16} aria-label="Share" /> <strong className="text-ink">Share</strong>, choose <strong className="text-ink">Add to Home Screen</strong>, then confirm.
            </p>
            <button type="button" onClick={() => setShowIosHelp(false)} className="btn-primary mt-5 w-full">Got it</button>
          </section>
        </div>
      )}
    </>
  );
}
