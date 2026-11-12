"use client";

import { useEffect } from "react";

/** Register the shared worker for offline fallback and push, without requesting permission. */
export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error: unknown) => {
      console.error("[pwa] Service worker registration failed:", error);
    });
  }, []);

  return null;
}