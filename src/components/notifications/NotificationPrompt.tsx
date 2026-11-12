"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, X } from "lucide-react";

const DISMISSED_KEY = "nunuza-notification-prompt-dismissed";

function decodeVapidKey(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function NotificationPrompt() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  const activate = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return false;
    setBusy(true);
    try {
      const permission = Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
      if (permission !== "granted") return false;

      const keyResponse = await fetch("/api/notifications/push-key", { cache: "no-store" });
      if (!keyResponse.ok) return false;
      const { publicKey } = await keyResponse.json() as { publicKey: string };
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(publicKey) as BufferSource,
        });
      }
      const response = await fetch("/api/notifications/push-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok) return false;
      sessionStorage.removeItem(DISMISSED_KEY);
      setVisible(false);
      return true;
    } catch (error) {
      console.error("[notifications] Could not activate browser notifications:", error);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      const dismissed = sessionStorage.getItem(DISMISSED_KEY) === "1";
      const permissionGranted = "Notification" in window && Notification.permission === "granted";
      if (!dismissed || permissionGranted) setVisible(true);
      if (permissionGranted) {
        // Keep the prompt visible until an existing browser permission is
        // successfully registered with this workspace.
        void activate().then((ok) => { if (active && ok) setVisible(false); });
      }
    });
    return () => { active = false; window.cancelAnimationFrame(frame); };
  }, [activate]);

  if (!visible) return null;

  return (
    <section aria-label="Enable notifications" className="relative mb-5 overflow-hidden rounded-2xl border border-forest/15 bg-gradient-to-br from-white to-forest-light/50 shadow-sm">
      <button
        type="button"
        aria-label="Dismiss notification reminder"
        onClick={() => {
          sessionStorage.setItem(DISMISSED_KEY, "1");
          setVisible(false);
        }}
        className="absolute right-3 top-3 rounded-lg p-2 text-ink-muted transition hover:bg-white/80 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest"
      >
        <X size={17} />
      </button>
      <div className="flex flex-col gap-4 p-5 pr-12 sm:flex-row sm:items-center sm:justify-between sm:p-6 sm:pr-14">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-forest text-white shadow-sm">
            <Bell size={20} />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-ink">Stay informed with Nunuza</h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-ink-secondary">
              Get important updates about your posts, approvals, and agent activity, even when you&apos;re away.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void activate()}
          disabled={busy}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-forest px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-forest/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
        >
          <Bell size={16} />
          {busy ? "Enabling..." : "Enable notifications"}
        </button>
      </div>
    </section>
  );
}
