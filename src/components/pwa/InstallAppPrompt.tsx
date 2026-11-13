"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, Share, X } from "lucide-react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const DISMISSED_UNTIL_KEY = "nunuza:pwa-install-dismissed-until:v1";
const REMINDER_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;

const subscribeToNothing = () => () => {};

function getDeviceState() {
  if (typeof window === "undefined") return { ios: false, mobile: false, installed: false };

  const ua = window.navigator.userAgent;
  const iosDevice = /iPad|iPhone|iPod/.test(ua) ||
    (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
  const mobile = iosDevice || /Android/i.test(ua);
  const installed = window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in window.navigator &&
      Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone));

  return { ios: iosDevice && !installed, mobile, installed };
}

const getServerDeviceState = () => ({ ios: false, mobile: false, installed: false });

function canShowReminder() {
  try {
    const dismissedUntil = Number(window.localStorage.getItem(DISMISSED_UNTIL_KEY) || 0);
    return !Number.isFinite(dismissedUntil) || Date.now() >= dismissedUntil;
  } catch {
    return true;
  }
}

function snoozeReminder() {
  try {
    window.localStorage.setItem(
      DISMISSED_UNTIL_KEY,
      String(Date.now() + REMINDER_INTERVAL_MS),
    );
  } catch {
    // The prompt still closes for this visit when storage is unavailable.
  }
}

export function InstallAppPrompt() {
  const device = useSyncExternalStore(subscribeToNothing, getDeviceState, getServerDeviceState);
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (device.installed || !device.mobile || !canShowReminder()) return;
    if (device.ios) setVisible(true);
  }, [device.installed, device.ios, device.mobile]);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      const currentDevice = getDeviceState();
      if (!currentDevice.mobile || currentDevice.installed) return;

      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
      if (canShowReminder()) setVisible(true);
    };

    const onInstalled = () => {
      setVisible(false);
      setShowIosHelp(false);
      setInstallEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    snoozeReminder();
    setVisible(false);
    setShowIosHelp(false);
  }

  async function install() {
    if (!installEvent) {
      setShowIosHelp(true);
      return;
    }

    setBusy(true);
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      setInstallEvent(null);
      if (choice.outcome === "accepted") {
        setVisible(false);
      } else {
        dismiss();
      }
    } finally {
      setBusy(false);
    }
  }

  if (!visible || device.installed || !device.mobile) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-ink/45 p-4 sm:items-center">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-nunuza-title"
        className="w-full max-w-sm rounded-2xl border border-border bg-white p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-forest-light text-forest">
            <Download size={22} aria-hidden="true" />
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss install invitation"
            className="rounded-lg p-2 text-ink-secondary transition hover:bg-surface"
          >
            <X size={18} />
          </button>
        </div>

        <h2 id="install-nunuza-title" className="text-lg font-semibold text-ink">
          Install Nunuza
        </h2>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">
          Add Nunuza to your home screen for a faster, app-like experience and easier access.
        </p>

        <button
          type="button"
          onClick={() => void install()}
          disabled={busy}
          className="btn-primary mt-5 flex w-full items-center justify-center gap-2 disabled:cursor-wait disabled:opacity-60"
        >
          <Download size={16} aria-hidden="true" />
          {busy ? "Opening install…" : "Install app"}
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="mt-3 w-full rounded-xl px-4 py-2.5 text-sm font-medium text-ink-secondary transition hover:bg-surface"
        >
          Not now
        </button>

        {showIosHelp && (
          <div className="mt-4 rounded-xl bg-surface p-4">
            <p className="text-sm leading-6 text-ink-secondary">
              In Safari, tap <Share className="mx-1 inline-block" size={16} aria-label="Share" />
              <strong className="text-ink">Share</strong>, choose{" "}
              <strong className="text-ink">Add to Home Screen</strong>, then confirm.
            </p>
            <button
              type="button"
              onClick={dismiss}
              className="mt-3 text-sm font-semibold text-forest"
            >
              Got it
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
