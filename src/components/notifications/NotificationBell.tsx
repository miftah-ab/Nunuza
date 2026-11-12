"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

export function NotificationBell() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/notifications", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as { unreadCount?: number };
        if (active) setCount(Number(data.unreadCount ?? 0));
      } catch { /* Inbox remains available when the counter refresh fails. */ }
    };
    void refresh();
    const interval = window.setInterval(refresh, 30_000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);
  return (
    <Link
      href="/app/notifications"
      aria-label={count ? `Notifications, ${count} unread` : "Notifications"}
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-white text-ink-secondary transition hover:border-forest/30 hover:bg-forest-light hover:text-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest"
    >
      <Bell size={18} />
      {count > 0 && (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-forest px-1 text-[10px] font-bold leading-none text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
