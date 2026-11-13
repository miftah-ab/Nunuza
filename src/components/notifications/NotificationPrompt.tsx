"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";

function decodeVapidKey(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 4) {
    throw new Error("The notification public key is invalid.");
  }
  return bytes;
}

function sameBytes(left: ArrayBuffer | null, right: Uint8Array): boolean {
  if (!left) return false;
  const current = new Uint8Array(left);
  return current.length === right.length && current.every((value, index) => value === right[index]);
}

export function NotificationPrompt() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>("default");

  const activate = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setError("This browser does not support notifications. Try a supported desktop browser.");
      return false;
    }

    setBusy(true);
    setError(null);
    try {
      let currentPermission = Notification.permission;
      if (currentPermission === "denied") {
        setPermission("denied");
        setError("Notifications are blocked in your browser. Open the site settings beside the address bar, allow notifications for Nunuza, then return and try again.");
        return false;
      }
      if (currentPermission === "default") {
        currentPermission = await Notification.requestPermission();
        setPermission(currentPermission);
      }
      if (currentPermission !== "granted") {
        setError("Choose Allow in your browser's notification prompt. This reminder will stay here until notifications are enabled.");
        return false;
      }

      const keyResponse = await fetch("/api/notifications/push-key", { cache: "no-store" });
      if (!keyResponse.ok) {
        setError("Notifications aren’t available right now. Please try again later.");
        return false;
      }
      const { publicKey } = await keyResponse.json() as { publicKey?: string };
      if (!publicKey) throw new Error("The notification public key is missing.");
      const applicationServerKey = decodeVapidKey(publicKey);
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;

      let subscription = await registration.pushManager.getSubscription();
      // A browser subscription is cryptographically tied to the VAPID public key
      // used when it was created. Reusing it after key rotation causes provider
      // authentication failures even though Notification.permission is granted.
      if (subscription && !sameBytes(subscription.options.applicationServerKey, applicationServerKey)) {
        const oldEndpoint = subscription.endpoint;
        await subscription.unsubscribe();
        const removal = await fetch("/api/notifications/push-subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: oldEndpoint }),
        });
        if (!removal.ok) throw new Error("We couldn’t refresh this device’s notification connection. Please try again.");
        subscription = null;
      }

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey as BufferSource,
        });
      }

      const response = await fetch("/api/notifications/push-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        setError(result.error || "We couldn’t save your notification settings. Please try again.");
        return false;
      }
      setVisible(false);
      return true;
    } catch (cause) {
      console.error("[notifications] Device push setup failed:", cause);
      setError(cause instanceof Error && cause.message.includes("refresh")
        ? cause.message
        : "We couldn’t connect this device to Nunuza notifications. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const frame = window.requestAnimationFrame(() => {
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        return;
      }

      setPermission(Notification.permission);
      if (Notification.permission === "granted") {
        // Permission alone is not a connected state. Reconcile the live browser
        // subscription and persist it on every authenticated app visit.
        void activate().then((ok) => {
          if (!active) return;
          setVisible(!ok);
        });
      } else {
        setVisible(true);
      }
    });
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
    };
  }, [activate]);

  if (!visible) return null;

  return (
    <section aria-label="Browser notifications" className="relative mb-5 overflow-hidden rounded-2xl border border-forest/15 bg-gradient-to-br from-white to-forest-light/50 shadow-sm">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-forest text-white shadow-sm">
            <Bell size={20} />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-ink">
              Stay informed with Nunuza
            </h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-ink-secondary">
              {permission === "denied"
                  ? "Notifications are currently blocked by your browser. Allow them in the site settings, then come back here. This reminder will stay visible until notifications are enabled."
                  : "Get important updates about your posts, approvals, and agent activity, even when you’re away. This reminder stays here until your device is connected."}
            </p>
            {error && <p role="alert" className="mt-2 text-sm text-error">{error}</p>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {visible && (
            <button
              type="button"
              onClick={() => void activate()}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-forest px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-forest/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
            >
              <Bell size={16} />
              {busy ? "Connecting..." : permission === "denied" ? "Check again" : "Enable notifications"}
            </button>
          )}

        </div>
      </div>
    </section>
  );
} 