"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Bell, Check, CheckCheck, AlertTriangle, Clock3, Bot, FileText, ShieldCheck, RefreshCw, Inbox,
} from "lucide-react";

type Notification = {
  id: string; category: string; priority: "normal" | "high" | "critical";
  title: string; body: string; href: string; read_at: string | null; created_at: string;
};
type InboxResponse = { notifications: Notification[]; unreadCount: number };

function iconFor(category: string) {
  if (category === "publishing") return FileText;
  if (category === "approval") return ShieldCheck;
  if (category === "agent") return Bot;
  if (category === "integration") return RefreshCw;
  return Bell;
}
function timeAgo(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function NotificationsPage() {
  const [data, setData] = useState<InboxResponse>({ notifications: [], unreadCount: 0 });
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (!response.ok) throw new Error("Your notifications could not be loaded.");
      setData(await response.json() as InboxResponse);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your notifications could not be loaded.");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 30_000); return () => window.clearInterval(timer); }, [refresh]);

  const markRead = async (id: string) => {
    const response = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (response.ok) setData((current) => ({ ...current, unreadCount: Math.max(0, current.unreadCount - 1), notifications: current.notifications.map((item) => item.id === id ? { ...item, read_at: new Date().toISOString() } : item) }));
  };
  const markAll = async () => {
    const response = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) });
    if (response.ok) setData((current) => ({ ...current, unreadCount: 0, notifications: current.notifications.map((item) => ({ ...item, read_at: item.read_at ?? new Date().toISOString() })) }));
  };
  const items = data.notifications.filter((item) => filter === "all" || !item.read_at);

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-16">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-forest"><Bell size={15} /> Your updates</div>
          <h1 className="text-3xl font-bold tracking-tight text-ink">Notifications</h1>
          <p className="mt-2 text-sm text-ink-secondary">Important updates and actions from Nunuza, all in one place.</p>
        </div>
        {data.unreadCount > 0 && <button onClick={() => void markAll()} className="inline-flex items-center justify-center gap-2 self-start rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-semibold text-ink-secondary transition hover:border-forest/30 hover:text-forest"><CheckCheck size={16} /> Mark all as read</button>}
      </div>

      <div className="flex items-center justify-between border-b border-border">
        <div className="flex gap-5">
          {(["all", "unread"] as const).map((value) => <button key={value} onClick={() => setFilter(value)} className={`relative pb-3 text-sm font-semibold capitalize transition ${filter === value ? "text-forest" : "text-ink-muted hover:text-ink"}`}>{value}{value === "unread" && data.unreadCount > 0 ? ` (${data.unreadCount})` : ""}{filter === value && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-forest" />}</button>)}
        </div>
        <span className="pb-3 text-xs text-ink-muted">{data.notifications.length} recent</span>
      </div>

      {error && <div role="alert" className="rounded-xl border border-error/20 bg-error-light p-4 text-sm text-error">{error}</div>}
      {loading ? <div className="space-y-3">{[1,2,3].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl border border-border bg-white" />)}</div>
        : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-white px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-forest-light text-forest"><Inbox size={25} /></div>
            <h2 className="text-base font-semibold text-ink">{filter === "unread" ? "You're all caught up" : "Nothing to see yet"}</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink-muted">{filter === "unread" ? "New important updates will appear here when they need your attention." : "When something important happens in your workspace, Nunuza will keep the update here."}</p>
          </div>
        ) : (
          <div className="space-y-3">{items.map((item) => {
            const Icon = iconFor(item.category);
            const critical = item.priority === "critical";
            return <article key={item.id} className={`group relative overflow-hidden rounded-2xl border bg-white transition hover:shadow-sm ${item.read_at ? "border-border" : "border-forest/25 shadow-[0_1px_0_rgba(0,0,0,0.02)]"}`}>
              {!item.read_at && <span className="absolute bottom-0 left-0 top-0 w-1 bg-forest" />}
              <div className="flex gap-3 p-4 sm:gap-4 sm:p-5">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${critical ? "bg-error-light text-error" : "bg-forest-light text-forest"}`}>{critical ? <AlertTriangle size={18} /> : <Icon size={18} />}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className={`text-sm ${item.read_at ? "font-medium text-ink" : "font-semibold text-ink"}`}>{item.title}</h2>
                    {critical && <span className="rounded-full bg-error-light px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-error">Action needed</span>}
                    {!item.read_at && <span className="h-1.5 w-1.5 rounded-full bg-forest" aria-label="Unread" />}
                  </div>
                  <p className="mt-1 text-sm leading-6 text-ink-secondary">{item.body}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <span className="inline-flex items-center gap-1 text-xs text-ink-muted"><Clock3 size={12} />{timeAgo(item.created_at)}</span>
                    <Link href={item.href} onClick={() => { if (!item.read_at) void markRead(item.id); }} className="inline-flex items-center gap-1 text-xs font-semibold text-forest hover:underline">View details <span aria-hidden="true">→</span></Link>
                    {!item.read_at && <button onClick={() => void markRead(item.id)} className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink"><Check size={13} /> Mark read</button>}
                  </div>
                </div>
              </div>
            </article>;
          })}</div>
        )}
    </div>
  );
}
